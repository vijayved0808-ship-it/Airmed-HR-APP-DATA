const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
    empId: { type: String, required: true, unique: true }, // e.g., AIRMED-001
    name: { type: String, required: true },
    password: { type: String, required: true }, // Normal PIN for now
    phone: { type: String, required: true },
    role: { type: String, default: 'employee' }, // 'admin' or 'employee'
    status: { type: String, default: 'active' }  // 'active' or 'disabled'
}, { timestamps: true });

module.exports = mongoose.model('Employee', employeeSchema);