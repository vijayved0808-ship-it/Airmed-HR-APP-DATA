const mongoose = require('mongoose');

const punchSchema = new mongoose.Schema({
    empId: { type: String, required: true },
    date: { type: String, required: true }, 
    entryTime: { type: String, default: null }, 
    entryLat: { type: Number, default: null },
    entryLng: { type: Number, default: null },
    exitTime: { type: String, default: null },
    exitLat: { type: Number, default: null },
    exitLng: { type: Number, default: null },
    status: { type: String, default: 'Leave' },
    errorLogs: { type: String, default: null },
    remark: { type: String, default: null } // <-- New field for employee remarks
}, { timestamps: true });

module.exports = mongoose.model('Punch', punchSchema);
