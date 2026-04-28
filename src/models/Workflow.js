const mongoose = require('mongoose')

const nodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'trigger',
        'sendMessage',
        'waitForReply',
        'condition',
        'menu',
        'delay',
        'setVariable',
        'httpRequest',
        'aiResponse',
        'addTag',
        'removeTag',
        'gotoWorkflow',
        'end'
      ],
      required: true
    },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 }
    },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { _id: false }
)

const edgeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
    sourceHandle: { type: String, default: null },
    targetHandle: { type: String, default: null },
    label: { type: String, default: '' }
  },
  { _id: false }
)

const workflowSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    instanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppInstance',
      required: true
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    nodes: [nodeSchema],
    edges: [edgeSchema],
    active: { type: Boolean, default: false },
    priority: { type: Number, default: 0 }
  },
  { timestamps: true }
)

workflowSchema.index({ userId: 1, instanceId: 1, active: 1 })

module.exports = mongoose.model('Workflow', workflowSchema)
