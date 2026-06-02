const mongoose = require('mongoose');

const punchSchema = new mongoose.Schema({
    empId: { type: String, required: true },
    date: { type: String, required: true }, 
    status: { type: String, default: 'Absent' },
    errorLogs: { type: String, default: null },
    remark: { type: String, default: null },
    punches: [{
        type: { type: String, enum: ['IN', 'OUT'] },
        time: { type: String }, 
        lat: { type: Number },
        lng: { type: Number },
        accuracy: { type: Number },
        location: { type: String }, // <-- NAYA: Location ka naam save hoga
        remark: { type: String, default: null }
    }]
}, { timestamps: true });

module.exports = mongoose.model('Punch', punchSchema);
