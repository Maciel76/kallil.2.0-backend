const mongoose = require('mongoose')

const workflowSessionSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    instanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppInstance', required: true },
    contactJid: { type: String, required: true },
    contactNumber: { type: String, required: true },
    currentNodeId: { type: String, required: true },
    waitingForReply: { type: Boolean, default: false },
    variables: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    lastActivity: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['active', 'completed', 'timeout', 'error'],
      default: 'active'
    }
  },
  { timestamps: true }
)

workflowSessionSchema.index({ instanceId: 1, contactJid: 1, status: 1 })
workflowSessionSchema.index({ lastActivity: 1 }, { expireAfterSeconds: 86400 }) // TTL 24h

module.exports = mongoose.model('WorkflowSession', workflowSessionSchema)
