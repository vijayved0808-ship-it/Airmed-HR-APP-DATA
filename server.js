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

app.get('/', (req, res) => res.redirect('/employee.html'));

// Is code se replace karein
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
      console.log("MongoDB Connected");
      
      // AUTO-CREATE DEFAULT ADMIN ACCOUNT
      const adminExists = await Employee.findOne({ role: 'admin' });
      if (!adminExists) {
          await new Employee({
              empId: 'admin',
              name: 'System Admin',
              password: 'admin', // Default Password
              role: 'admin',
              shiftStart: '00:00',
              dutyHours: 0
          }).save();
          console.log("✅ Default Admin created automatically!");
      }
  })
  .catch(err => console.log(err));

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const φ1 = lat1 * Math.PI/180; const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180; const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); 
}

// ====== EMPLOYEE PORTAL APIs ======
app.post('/api/login', async (req, res) => {
    // SECURITY: Prevent NoSQL Injection by enforcing String type
    const empId = String(req.body.empId);
    const password = String(req.body.password);
    
    const emp = await Employee.findOne({ empId, password });
    if (!emp) return res.status(401).json({ success: false, message: "Invalid ID or Password" });
    if (emp.status === 'disabled') return res.status(403).json({ success: false, message: "Account disabled." });
    
    res.json({ success: true, name: emp.name, empId: emp.empId, role: emp.role });
});

app.post('/api/punch', async (req, res) => {
    const empId = String(req.body.empId);
    const { type, lat, lng, accuracy, remark } = req.body;
    
    const empInfo = await Employee.findOne({ empId });
    if (!empInfo) return res.status(400).json({ success: false, message: "Employee not found." });

    const savedLocations = await Location.find({});
    let matchedLocation = null;
    let aiAssisted = false;

    for (let loc of savedLocations) {
        const dist = getDistance(lat, lng, loc.lat, loc.lng);
        const safeRadius = loc.radius || 150; // Dynamic Radius from DB
        const gpsErrorMargin = accuracy || 0; 
        
        if (dist <= safeRadius) { 
            matchedLocation = loc.name; break;
        } else if (dist <= (safeRadius + gpsErrorMargin) && gpsErrorMargin <= 500) {
            matchedLocation = loc.name; aiAssisted = true; break;
        }
    }

    const now = new Date();
    const istOffset = 330 * 60000; 
    const istDate = new Date(now.getTime() + istOffset);
    const today = istDate.toISOString().split('T')[0];
    const nowTime = istDate.toISOString().split('T')[1].substring(0, 8); 

    let punchRecord = await Punch.findOne({ empId, date: today });
    if (!punchRecord) punchRecord = new Punch({ empId, date: today, punches: [] });

    let finalRemark = remark ? `${type}: ${remark}` : null;

    if (!matchedLocation) {
        const errorMsg = `🚨 Rejected ${type} at ${nowTime} (Out of geofence)`;
        punchRecord.errorLogs = punchRecord.errorLogs ? punchRecord.errorLogs + ' | ' + errorMsg : errorMsg;
        if(finalRemark) punchRecord.remark = punchRecord.remark ? punchRecord.remark + ' | ' + finalRemark : finalRemark;
        await punchRecord.save();
        return res.status(400).json({ success: false, message: "Geofence ke bahar! Kripya authorized clinic par jayein." });
    }

    const lastPunch = punchRecord.punches[punchRecord.punches.length - 1];
    if (type === 'IN' && lastPunch && lastPunch.type === 'IN') return res.status(400).json({ success: false, message: "Already IN. Pehle OUT karein." });
    if (type === 'OUT' && (!lastPunch || lastPunch.type === 'OUT')) return res.status(400).json({ success: false, message: "Pehle Punch IN zaroori hai." });

    punchRecord.punches.push({ type, time: nowTime, lat, lng, accuracy, location: matchedLocation, remark: remark || null });

    if (finalRemark) punchRecord.remark = punchRecord.remark ? punchRecord.remark + ' | ' + finalRemark : finalRemark;
    if (aiAssisted) {
        const aiLogMsg = `🤖 AI Approved (${type}): GPS signal drifting.`;
        punchRecord.errorLogs = punchRecord.errorLogs ? punchRecord.errorLogs + ' | ' + aiLogMsg : aiLogMsg;
    }

    // CROSS-MIDNIGHT SHIFT LOGIC FIX
    let totalMs = 0;
    for (let i = 0; i < punchRecord.punches.length; i++) {
        if (punchRecord.punches[i].type === 'IN' && punchRecord.punches[i+1] && punchRecord.punches[i+1].type === 'OUT') {
            let t1 = new Date(`1970-01-01T${punchRecord.punches[i].time}Z`).getTime();
            let t2 = new Date(`1970-01-01T${punchRecord.punches[i+1].time}Z`).getTime();
            if (t2 < t1) t2 += (24 * 60 * 60 * 1000); // Add 24 hours if out-time is next day
            totalMs += (t2 - t1);
        }
    }
    const totalHours = totalMs / (1000 * 60 * 60);

    punchRecord.status = totalHours >= (empInfo.dutyHours || 9) ? "Present" : (totalHours > 0 ? "Half Day" : "Miss Punch");
    await punchRecord.save();
    res.json({ success: true, message: `Punched ${type} at ${matchedLocation}`, time: nowTime });
});

app.get('/api/employee/history', async (req, res) => {
    res.json({ success: true, history: await Punch.find({ empId: String(req.query.empId) }).sort({ date: -1 }).limit(30) });
});

// ====== ADMIN PANEL APIs ======
// Basic Admin Middleware for verification (Client passes role)
const verifyAdmin = (req, res, next) => {
    if(req.headers['x-admin-role'] !== 'admin') return res.status(403).json({ error: 'Unauthorized Access' });
    next();
}

app.get('/api/admin/employees', verifyAdmin, async (req, res) => {
    res.json(await Employee.find({ role: { $ne: 'admin' } }));
});

app.post('/api/admin/employees', verifyAdmin, async (req, res) => {
    const { empId, name, password, phone, shiftStart, dutyHours, id } = req.body;
    if (id) {
        await Employee.findByIdAndUpdate(id, { empId, name, password, phone, shiftStart, dutyHours });
        return res.json({ success: true, message: "Updated." });
    }
    const exist = await Employee.findOne({ empId });
    if (exist) return res.status(400).json({ success: false, message: "ID exists." });
    await new Employee({ empId, name, password, phone, shiftStart, dutyHours }).save();
    res.json({ success: true, message: "Added." });
});

app.put('/api/admin/employees/status', verifyAdmin, async (req, res) => {
    await Employee.findByIdAndUpdate(req.body.id, { status: req.body.status });
    res.json({ success: true });
});

app.get('/api/admin/locations', verifyAdmin, async (req, res) => {
    res.json(await Location.find({}));
});

app.post('/api/admin/locations', verifyAdmin, async (req, res) => {
    const { name, lat, lng, radius } = req.body;
    await Location.findOneAndUpdate({ name }, { lat, lng, radius }, { upsert: true });
    res.json({ success: true });
});

app.delete('/api/admin/locations/:id', verifyAdmin, async (req, res) => {
    await Location.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.get('/api/admin/reports', verifyAdmin, async (req, res) => {
    let query = {};
    if (req.query.from && req.query.to) query.date = { $gte: req.query.from, $lte: req.query.to };
    if (req.query.empId) query.empId = req.query.empId;
    res.json(await Punch.find(query).sort({ date: -1 }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
