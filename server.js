const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const Employee = require('./models/Employee');
const Punch = require('./models/Punch');
const Location = require('./models/Location'); 

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
    const { empId, type, lat, lng, accuracy, remark } = req.body;
    
    const savedLocations = await Location.find({});
    let matchedLocation = null;
    let aiAssisted = false;

    // AI Intelligence Location Matching
    for (let loc of savedLocations) {
        const dist = getDistance(lat, lng, loc.lat, loc.lng);
        const safeRadius = 150; 
        const gpsErrorMargin = accuracy || 0; // Capture phone's reported accuracy
        
        // Case 1: Direct perfect hit
        if (dist <= safeRadius) { 
            matchedLocation = loc.name;
            break;
        } 
        // Case 2: AI Assisted hit (Phone is drifting, but drift margin touches our circle)
        else if (dist <= (safeRadius + gpsErrorMargin) && gpsErrorMargin <= 500) {
            matchedLocation = loc.name;
            aiAssisted = true;
            break;
        }
    }

    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toTimeString().split(' ')[0];
    let punchRecord = await Punch.findOne({ empId, date: today });

    let finalRemark = remark ? `${type}: ${remark}` : null;

    // Rejected Punch (Out of range entirely)
    if (!matchedLocation) {
        const errorMsg = `🚨 Rejected Attempt (${type} at ${nowTime}). Out of geofence.`;
        if (punchRecord) {
            punchRecord.errorLogs = punchRecord.errorLogs ? punchRecord.errorLogs + ' | ' + errorMsg : errorMsg;
            if(finalRemark) punchRecord.remark = punchRecord.remark ? punchRecord.remark + ' | ' + finalRemark : finalRemark;
            await punchRecord.save();
        } else {
            punchRecord = new Punch({ empId, date: today, errorLogs: errorMsg, remark: finalRemark });
            await punchRecord.save();
        }
        return res.status(400).json({ success: false, message: "Punch Rejected! Aap kisi bhi authorize clinic ke andar nahi hain." });
    }

    let aiLogMsg = aiAssisted ? `🤖 AI Approved (${type}): GPS signal drifting.` : null;

    // Processing Valid Punch
    if (type === 'IN') {
        if (punchRecord && punchRecord.entryTime) return res.status(400).json({ success: false, message: "Already Punched IN today." });
        if (!punchRecord) {
            punchRecord = new Punch({ empId, date: today, entryTime: nowTime, entryLat: lat, entryLng: lng, status: "Miss Punch", remark: finalRemark, errorLogs: aiLogMsg });
        } else {
            punchRecord.entryTime = nowTime; punchRecord.entryLat = lat; punchRecord.entryLng = lng;
            if(finalRemark) punchRecord.remark = punchRecord.remark ? punchRecord.remark + ' | ' + finalRemark : finalRemark;
            if(aiLogMsg) punchRecord.errorLogs = punchRecord.errorLogs ? punchRecord.errorLogs + ' | ' + aiLogMsg : aiLogMsg;
        }
    } else if (type === 'OUT') {
        if (!punchRecord || !punchRecord.entryTime) return res.status(400).json({ success: false, message: "Please Punch IN first." });
        if (punchRecord.exitTime) return res.status(400).json({ success: false, message: "Already Punched OUT today." });
        
        punchRecord.exitTime = nowTime; punchRecord.exitLat = lat; punchRecord.exitLng = lng;
        if(finalRemark) punchRecord.remark = punchRecord.remark ? punchRecord.remark + ' | ' + finalRemark : finalRemark;
        if(aiLogMsg) punchRecord.errorLogs = punchRecord.errorLogs ? punchRecord.errorLogs + ' | ' + aiLogMsg : aiLogMsg;
        
        const hours = (new Date(`1970-01-01T${nowTime}Z`) - new Date(`1970-01-01T${punchRecord.entryTime}Z`)) / (1000 * 60 * 60);
        punchRecord.status = hours >= 4 ? "Present" : "Half Day";
    }

    await punchRecord.save();
    const successMsg = aiAssisted ? `Punched ${type} Successfully (AI Assisted due to weak GPS)` : `Punched ${type} at ${matchedLocation} (${nowTime})`;
    res.json({ success: true, message: successMsg });
});

app.get('/api/employee/history', async (req, res) => {
    const { empId } = req.query;
    if(!empId) return res.status(400).json({success: false, message: "Employee ID required"});
    const history = await Punch.find({ empId }).sort({ date: -1 }).limit(30); 
    res.json({ success: true, history });
});

// ====== ADMIN PANEL APIs ======

app.get('/api/admin/employees', async (req, res) => {
    const emps = await Employee.find({ role: { $ne: 'admin' } });
    res.json(emps);
});

app.post('/api/admin/employees', async (req, res) => {
    const { empId, name, password, phone, id } = req.body;
    if (id) {
        await Employee.findByIdAndUpdate(id, { empId, name, password, phone });
        return res.json({ success: true, message: "Employee updated successfully." });
    } else {
        const exist = await Employee.findOne({ empId });
        if (exist) return res.status(400).json({ success: false, message: "Employee ID already exists." });
        const newEmp = new Employee({ empId, name, password, phone });
        await newEmp.save();
        res.json({ success: true, message: "Employee added successfully." });
    }
});

app.put('/api/admin/employees/status', async (req, res) => {
    const { id, status } = req.body;
    await Employee.findByIdAndUpdate(id, { status });
    res.json({ success: true, message: `Employee status changed to ${status}.` });
});

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

app.get('/api/admin/reports', async (req, res) => {
    const { from, to, empId } = req.query;
    let query = {};
    if (from && to) query.date = { $gte: from, $lte: to };
    if (empId) query.empId = empId;

    const punches = await Punch.find(query).sort({ date: -1 });
    res.json(punches);
});

app.post('/api/admin/bulk-punch', async (req, res) => {
    const { punches } = req.body;
    try {
        for (let p of punches) {
            await Punch.findOneAndUpdate(
                { empId: p.empId, date: p.date }, 
                { 
                    $set: {
                        entryTime: p.entryTime,
                        exitTime: p.exitTime,
                        status: p.status
                    }
                }, 
                { upsert: true, new: true }
            );
        }
        res.json({ success: true, message: "Bulk data imported successfully." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
