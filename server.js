const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const Employee = require('./models/Employee');
const Punch = require('./models/Punch');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection (Replace with your Atlas URI later)
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/airmed_hr', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB Connected")).catch(err => console.log(err));

// AIRMED LAB BASE LOCATION (Update with exact Ahmedabad coordinates)
const LAB_LAT = 23.0300; 
const LAB_LNG = 72.5800;
const GEOFENCE_RADIUS_METERS = 50;

// Helper: Distance Calculator
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

// 1. Employee Login API
app.post('/api/login', async (req, res) => {
    const { empId, password } = req.body;
    const emp = await Employee.findOne({ empId, password });
    
    if (!emp) return res.status(401).json({ success: false, message: "Invalid ID or Password" });
    if (emp.status === 'disabled') return res.status(403).json({ success: false, message: "Account disabled. Contact Admin." });
    
    res.json({ success: true, name: emp.name, empId: emp.empId });
});

// 2. Punch API
app.post('/api/punch', async (req, res) => {
    const { empId, type, lat, lng } = req.body;
    
    // Check Geofence
    const distance = getDistance(lat, lng, LAB_LAT, LAB_LNG);
    if (distance > GEOFENCE_RADIUS_METERS) {
        return res.status(400).json({ success: false, message: `You are out of range (${Math.round(distance)}m away). Must be within 50m.` });
    }

    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toTimeString().split(' ')[0];

    let punchRecord = await Punch.findOne({ empId, date: today });

    if (type === 'IN') {
        if (punchRecord && punchRecord.entryTime) return res.status(400).json({ success: false, message: "Already Punched IN today." });
        
        if (!punchRecord) {
            punchRecord = new Punch({ empId, date: today, entryTime: nowTime, entryLat: lat, entryLng: lng, status: "Miss Punch" });
        } else {
            punchRecord.entryTime = nowTime;
            punchRecord.entryLat = lat;
            punchRecord.entryLng = lng;
        }
    } else if (type === 'OUT') {
        if (!punchRecord || !punchRecord.entryTime) return res.status(400).json({ success: false, message: "You must Punch IN first." });
        if (punchRecord.exitTime) return res.status(400).json({ success: false, message: "Already Punched OUT today." });
        
        punchRecord.exitTime = nowTime;
        punchRecord.exitLat = lat;
        punchRecord.exitLng = lng;

        // Auto-calculate Status
        const inDate = new Date(`1970-01-01T${punchRecord.entryTime}Z`);
        const outDate = new Date(`1970-01-01T${nowTime}Z`);
        const hours = (outDate - inDate) / (1000 * 60 * 60);
        punchRecord.status = hours >= 4 ? "Present" : "Half Day";
    }

    await punchRecord.save();
    res.json({ success: true, message: `Punched ${type} Successfully at ${nowTime}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));