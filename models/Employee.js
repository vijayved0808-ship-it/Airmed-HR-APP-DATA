const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
    empId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    password: { type: String, required: true },
    phone: { type: String },
    role: { type: String, default: 'employee' },
    status: { type: String, default: 'active' },
    shiftStart: { type: String, default: '09:00' }, // Naya: Shift kitne baje shuru hoti hai
    dutyHours: { type: Number, default: 9 } // Naya: Total expected kaam ke ghante
}, { timestamps: true });

module.exports = mongoose.model('Employee', employeeSchema);
