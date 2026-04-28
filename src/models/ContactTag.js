const mongoose = require('mongoose')

const contactTagSchema = new mongoose.Schema(
  {
    instanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppInstance', required: true },
    contactJid: { type: String, required: true },
    tags: [{ type: String }]
  },
  { timestamps: true }
)

contactTagSchema.index({ instanceId: 1, contactJid: 1 }, { unique: true })

module.exports = mongoose.model('ContactTag', contactTagSchema)
