const mongoose = require('mongoose');

const punchSchema = new mongoose.Schema({
    empId: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD format
    entryTime: { type: String, default: null }, // HH:mm:ss
    entryLat: { type: Number, default: null },
    entryLng: { type: Number, default: null },
    exitTime: { type: String, default: null },
    exitLat: { type: Number, default: null },
    exitLng: { type: Number, default: null },
    status: { type: String, default: 'Leave' } // Present, Half Day, Miss Punch
}, { timestamps: true });

module.exports = mongoose.model('Punch', punchSchema);