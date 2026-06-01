const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const Employee = require('./models/Employee');
const Punch = require('./models/Punch');
const Location = require('./models/Location'); // Naya model import

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB Connected")).catch(err => console.log(err));

// Helper: Distance Calculator (Haversine)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

// ====== EMPLOYEE PORTAL APIs ======

app.post('/api/login', async (req, res) => {
    const { empId, password } = req.body;
    const emp = await Employee.findOne({ empId, password });
    if (!emp) return res.status(401).json({ success: false, message: "Invalid ID or Password" });
    if (emp.status === 'disabled') return res.status(403).json({ success: false, message: "Account disabled. Contact Admin." });
    res.json({ success: true, name: emp.name, empId: emp.empId });
});

app.post('/api/punch', async (req, res) => {
    const { empId, type, lat, lng } = req.body;
    
    // DB se saari active locations/clinics fetch karein
    const savedLocations = await Location.find({});
    let matchedLocation = null;

    for (let loc of savedLocations) {
        const dist = getDistance(lat, lng, loc.lat, loc.lng);
        if (dist <= loc.radius) {
            matchedLocation = loc.name;
            break;
        }
    }

    // Agar kisi clinic ke 50m radius me nahi hai toh block karein
    if (!matchedLocation) {
        return res.status(400).json({ success: false, message: "Punch Rejected! Aap kisi bhi authorize clinic/geofence ke andar nahi hain." });
    }

    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toTimeString().split(' ')[0];
    let punchRecord = await Punch.findOne({ empId, date: today });

    if (type === 'IN') {
        if (punchRecord && punchRecord.entryTime) return res.status(400).json({ success: false, message: "Already Punched IN today." });
        if (!punchRecord) {
            punchRecord = new Punch({ empId, date: today, entryTime: nowTime, entryLat: lat, entryLng: lng, status: "Miss Punch" });
        } else {
            punchRecord.entryTime = nowTime; punchRecord.entryLat = lat; punchRecord.entryLng = lng;
        }
    } else if (type === 'OUT') {
        if (!punchRecord || !punchRecord.entryTime) return res.status(400).json({ success: false, message: "Pehle Punch IN karein." });
        if (punchRecord.exitTime) return res.status(400).json({ success: false, message: "Already Punched OUT today." });
        
        punchRecord.exitTime = nowTime; punchRecord.exitLat = lat; punchRecord.exitLng = lng;
        const hours = (new Date(`1970-01-01T${nowTime}Z`) - new Date(`1970-01-01T${punchRecord.entryTime}Z`)) / (1000 * 60 * 60);
        punchRecord.status = hours >= 4 ? "Present" : "Half Day";
    }

    await punchRecord.save();
    res.json({ success: true, message: `Punched ${type} at ${matchedLocation} (${nowTime})` });
});


// ====== ADMIN PANEL APIs ======

// 1. Get All Employees
app.get('/api/admin/employees', async (req, res) => {
    const emps = await Employee.find({ role: { $ne: 'admin' } });
    res.json(emps);
});

// 2. Add / Edit Employee
app.post('/api/admin/employees', async (req, res) => {
    const { empId, name, password, phone, id } = req.body;
    if (id) {
        // Edit Existing
        await Employee.findByIdAndUpdate(id, { empId, name, password, phone });
        return res.json({ success: true, message: "Employee updated successfully." });
    } else {
        // Add New
        const exist = await Employee.findOne({ empId });
        if (exist) return res.status(400).json({ success: false, message: "Employee ID already exists." });
        const newEmp = new Employee({ empId, name, password, phone });
        await newEmp.save();
        res.json({ success: true, message: "Employee added successfully." });
    }
});

// 3. Toggle Status (Disable/Active) - NO DELETE
app.put('/api/admin/employees/status', async (req, res) => {
    const { id, status } = req.body;
    await Employee.findByIdAndUpdate(id, { status });
    res.json({ success: true, message: `Employee status changed to ${status}.` });
});

// 4. Get/Save/Delete Dynamic Geofences
app.get('/api/admin/locations', async (req, res) => {
    const locs = await Location.find({});
    res.json(locs);
});

app.post('/api/admin/locations', async (req, res) => {
    const { name, lat, lng } = req.body;
    await Location.findOneAndUpdate({ name }, { lat, lng }, { upsert: true });
    res.json({ success: true, message: "Location/Geofence saved." });
});

app.delete('/api/admin/locations/:id', async (req, res) => {
    await Location.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Location deleted." });
});

// 5. HR Attendance Reports (Live, Filter by Date & Employee)
app.get('/api/admin/reports', async (req, res) => {
    const { from, to, empId } = req.query;
    let query = {};
    if (from && to) query.date = { $gte: from, $lte: to };
    if (empId) query.empId = empId;

    const punches = await Punch.find(query);
    res.json(punches);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));