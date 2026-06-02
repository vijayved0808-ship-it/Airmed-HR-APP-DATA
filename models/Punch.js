const mongoose = require('mongoose');

const punchSchema = new mongoose.Schema({
    empId: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    status: { type: String, default: 'Absent' },
    errorLogs: { type: String, default: null },
    remark: { type: String, default: null },
    punches: [{
        type: { type: String, enum: ['IN', 'OUT'] },
        time: { type: String }, // HH:MM:SS
        lat: { type: Number },
        lng: { type: Number },
        accuracy: { type: Number },
        remark: { type: String, default: null }
    }]
}, { timestamps: true });

module.exports = mongoose.model('Punch', punchSchema);
