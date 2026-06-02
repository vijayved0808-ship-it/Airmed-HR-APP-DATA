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

app.get('/', (req, res) => {
    res.redirect('/employee.html');
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

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
    
    const empInfo = await Employee.findOne({ empId });
    if (!empInfo) return res.status(400).json({ success: false, message: "Employee not found." });

    const savedLocations = await Location.find({});
    let matchedLocation = null;
    let aiAssisted = false;

    for (let loc of savedLocations) {
        const dist = getDistance(lat, lng, loc.lat, loc.lng);
        const safeRadius = 150; 
        const gpsErrorMargin = accuracy || 0; 
        
        if (dist <= safeRadius) { 
            matchedLocation = loc.name;
            break;
        } else if (dist <= (safeRadius + gpsErrorMargin) && gpsErrorMargin <= 500) {
            matchedLocation = loc.name;
            aiAssisted = true;
            break;
        }
    }

    const now = new Date();
    const istOffset = 330 * 60000; 
    const istDate = new Date(now.getTime() + istOffset);
    const today = istDate.toISOString().split('T')[0];
    const nowTime = istDate.toISOString().split('T')[1].substring(0, 8); 

    let punchRecord = await Punch.findOne({ empId, date: today });
    if (!punchRecord) {
        punchRecord = new Punch({ empId, date: today, punches: [] });
    }

    let finalRemark = remark ? `${type}: ${remark}` : null;

    if (!matchedLocation) {
        const errorMsg = `🚨 Rejected ${type} at ${nowTime} (Out of geofence)`;
        punchRecord.errorLogs = punchRecord.errorLogs ? punchRecord.errorLogs + ' | ' + errorMsg : errorMsg;
        if(finalRemark) punchRecord.remark = punchRecord.remark ? punchRecord.remark + ' | ' + finalRemark : finalRemark;
        await punchRecord.save();
        return res.status(400).json({ success: false, message: "Punch Rejected! Aap kisi authorized clinic range me nahi hain." });
    }

    const lastPunch = punchRecord.punches[punchRecord.punches.length - 1];
    if (type === 'IN' && lastPunch && lastPunch.type === 'IN') {
        return res.status(400).json({ success: false, message: "Aap pehle se Punched IN hain! Pehle OUT register karein." });
    }
    if (type === 'OUT' && (!lastPunch || lastPunch.type === 'OUT')) {
        return res.status(400).json({ success: false, message: "Pehle Punch IN karna zaroori hai." });
    }

    // UPDATE: Saving matchedLocation in DB array
    punchRecord.punches.push({ type, time: nowTime, lat, lng, accuracy, location: matchedLocation, remark: remark || null });

    if (finalRemark) { punchRecord.remark = punchRecord.remark ? punchRecord.remark + ' | ' + finalRemark : finalRemark; }
    if (aiAssisted) {
        const aiLogMsg = `🤖 AI Approved (${type}): GPS signal drifting.`;
        punchRecord.errorLogs = punchRecord.errorLogs ? punchRecord.errorLogs + ' | ' + aiLogMsg : aiLogMsg;
    }

    let totalMs = 0;
    for (let i = 0; i < punchRecord.punches.length; i++) {
        if (punchRecord.punches[i].type === 'IN' && punchRecord.punches[i+1] && punchRecord.punches[i+1].type === 'OUT') {
            const t1 = new Date(`1970-01-01T${punchRecord.punches[i].time}Z`);
            const t2 = new Date(`1970-01-01T${punchRecord.punches[i+1].time}Z`);
            totalMs += (t2 - t1);
        }
    }
    const totalHours = totalMs / (1000 * 60 * 60);

    if (totalHours > 0) {
        punchRecord.status = totalHours >= empInfo.dutyHours ? "Present" : "Half Day";
    } else {
        punchRecord.status = "Miss Punch";
    }

    await punchRecord.save();
    res.json({ success: true, message: `Punched ${type} at ${matchedLocation}`, time: nowTime });
});

app.get('/api/employee/history', async (req, res) => {
    const { empId } = req.query;
    const history = await Punch.find({ empId }).sort({ date: -1 }).limit(30); 
    res.json({ success: true, history });
});

// ====== ADMIN PANEL APIs ======
app.get('/api/admin/employees', async (req, res) => {
    const emps = await Employee.find({ role: { $ne: 'admin' } });
    res.json(emps);
});

app.post('/api/admin/employees', async (req, res) => {
    const { empId, name, password, phone, shiftStart, dutyHours, id } = req.body;
    if (id) {
        await Employee.findByIdAndUpdate(id, { empId, name, password, phone, shiftStart, dutyHours });
        return res.json({ success: true, message: "Employee updated successfully." });
    } else {
        const exist = await Employee.findOne({ empId });
        if (exist) return res.status(400).json({ success: false, message: "Employee ID already exists." });
        const newEmp = new Employee({ empId, name, password, phone, shiftStart, dutyHours });
        await newEmp.save();
        res.json({ success: true, message: "Employee added successfully." });
    }
});

app.put('/api/admin/employees/status', async (req, res) => {
    const { id, status } = req.body;
    await Employee.findByIdAndUpdate(id, { status });
    res.json({ success: true, message: `Status changed to ${status}.` });
});

app.get('/api/admin/locations', async (req, res) => {
    res.json(await Location.find({}));
});

app.post('/api/admin/locations', async (req, res) => {
    const { name, lat, lng } = req.body;
    await Location.findOneAndUpdate({ name }, { lat, lng }, { upsert: true });
    res.json({ success: true });
});

app.delete('/api/admin/locations/:id', async (req, res) => {
    await Location.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.get('/api/admin/reports', async (req, res) => {
    const { from, to, empId } = req.query;
    let query = {};
    if (from && to) query.date = { $gte: from, $lte: to };
    if (empId) query.empId = empId;
    res.json(await Punch.find(query).sort({ date: -1 }));
});

// BULK UPLOAD 
app.post('/api/admin/bulk-punch', async (req, res) => {
    const { punches } = req.body;
    try {
        for (let p of punches) {
            const empExist = await Employee.findOne({ empId: p.empId });
            if (!empExist) {
                await new Employee({
                    empId: p.empId, name: `New (${p.empId})`, password: "123", shiftStart: "09:00", dutyHours: 9
                }).save();
            }
            let newPunches = [];
            if(p.entryTime) newPunches.push({ type: 'IN', time: p.entryTime, lat: p.entryLat, lng: p.entryLng, location: "Excel Upload" });
            if(p.exitTime) newPunches.push({ type: 'OUT', time: p.exitTime, lat: p.exitLat, lng: p.exitLng, location: "Excel Upload" });

            await Punch.findOneAndUpdate(
                { empId: p.empId, date: p.date }, 
                { $set: { status: p.status }, $push: { punches: { $each: newPunches } } }, 
                { upsert: true }
            );
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
