const Workflow = require('../models/Workflow')
const WorkflowSession = require('../models/WorkflowSession')
const ContactTag = require('../models/ContactTag')

class WorkflowEngine {
  /**
   * Processa uma mensagem recebida no contexto de workflows.
   * Retorna true se algum workflow tratou a mensagem.
   */
  static async processMessage({
    instanceId,
    jid,
    number,
    message,
    pushName,
    isNewContact,
    msgKey,
    whatsapp
  }) {
    try {
      // 1) Sessão ativa?
      let session = await WorkflowSession.findOne({
        instanceId,
        contactJid: jid,
        status: 'active'
      })

      if (session) {
        if (!session.waitingForReply) {
          // Sessão zumbi
          session.status = 'completed'
          await session.save()
        } else {
          return await WorkflowEngine._continueSession(
            session,
            message,
            pushName,
            msgKey,
            whatsapp
          )
        }
      }

      // 2) Busca workflows ativos
      const workflows = await Workflow.find({ instanceId, active: true }).sort({ priority: -1 })
      if (workflows.length === 0) return false

      for (const workflow of workflows) {
        const triggerNode = workflow.nodes.find(n => n.type === 'trigger')
        if (!triggerNode) continue

        const matched = WorkflowEngine._matchTrigger(triggerNode.data, message, isNewContact)
        if (!matched) continue

        const nextNodeId = WorkflowEngine._getNextNodeId(workflow, triggerNode.id)
        if (!nextNodeId) continue

        session = await WorkflowSession.create({
          workflowId: workflow._id,
          instanceId,
          contactJid: jid,
          contactNumber: number,
          currentNodeId: triggerNode.id,
          variables: {
            nome: pushName || number,
            numero: number,
            mensagem: message,
            jid
          }
        })

        console.log(`[WORKFLOW] 🚀 Iniciando "${workflow.name}" para ${pushName || number}`)
        await WorkflowEngine._executeNode(
          session,
          workflow,
          nextNodeId,
          message,
          pushName,
          msgKey,
          whatsapp
        )
        return true
      }
      return false
    } catch (err) {
      console.error('[WORKFLOW] ❌ Erro:', err.message)
      return false
    }
  }

  static async _continueSession(session, message, pushName, msgKey, whatsapp) {
    try {
      const workflow = await Workflow.findById(session.workflowId)
      if (!workflow || !workflow.active) {
        session.status = 'completed'
        await session.save()
        return false
      }

      session.variables.set('mensagem', message)
      session.variables.set('ultima_resposta', message)
      session.lastActivity = new Date()
      session.markModified('variables')

      const currentNode = workflow.nodes.find(n => n.id === session.currentNodeId)
      if (!currentNode) {
        session.status = 'error'
        await session.save()
        return false
      }

      session.waitingForReply = false

      if (currentNode.type === 'menu') {
        await WorkflowEngine._processMenuResponse(
          session,
          workflow,
          currentNode,
          message,
          pushName,
          msgKey,
          whatsapp
        )
        return true
      }

      if (currentNode.data.variableName) {
        session.variables.set(currentNode.data.variableName, message)
        session.markModified('variables')
      }

      const nextNodeId = WorkflowEngine._getNextNodeId(workflow, currentNode.id)
      if (nextNodeId) {
        await WorkflowEngine._executeNode(
          session,
          workflow,
          nextNodeId,
          message,
          pushName,
          msgKey,
          whatsapp
        )
      } else {
        session.status = 'completed'
        await session.save()
      }
      return true
    } catch (err) {
      console.error('[WORKFLOW] ❌ continueSession:', err.message)
      session.status = 'error'
      await session.save()
      return false
    }
  }

  static async _executeNode(session, workflow, nodeId, message, pushName, msgKey, whatsapp) {
    const node = workflow.nodes.find(n => n.id === nodeId)
    if (!node) {
      session.status = 'completed'
      await session.save()
      return
    }

    session.currentNodeId = nodeId
    session.lastActivity = new Date()
    await session.save()

    const advance = async () => {
      const nextId = WorkflowEngine._getNextNodeId(workflow, nodeId)
      if (nextId) {
        await WorkflowEngine._executeNode(session, workflow, nextId, message, pushName, msgKey, whatsapp)
      } else {
        session.status = 'completed'
        await session.save()
      }
    }

    switch (node.type) {
      case 'sendMessage': {
        const text = WorkflowEngine._replaceVariables(node.data.message || '', session.variables)
        const delay = node.data.delay || 1500
        if (text) {
          try {
            await whatsapp.sendMessageHuman(session.contactJid, text, msgKey, delay)
          } catch (err) {
            console.error(`[WORKFLOW] erro sendMessage: ${err.message}`)
          }
        }
        await advance()
        break
      }

      case 'waitForReply': {
        if (node.data.message) {
          const promptText = WorkflowEngine._replaceVariables(node.data.message, session.variables)
          try {
            await whatsapp.sendMessageHuman(session.contactJid, promptText, msgKey, 1000)
          } catch (err) {
            /* ignora */
          }
        }
        session.waitingForReply = true
        await session.save()
        break
      }

      case 'condition': {
        const varName = node.data.variable || 'ultima_resposta'
        const operator = node.data.operator || 'contains'
        const compareValue = (node.data.value || '').toLowerCase()
        let condResult = false

        if (operator === 'hasTag' || operator === 'notHasTag') {
          const tagDoc = await ContactTag.findOne({
            instanceId: session.instanceId,
            contactJid: session.contactJid
          })
          const tags = tagDoc ? tagDoc.tags : []
          condResult = operator === 'hasTag' ? tags.includes(compareValue) : !tags.includes(compareValue)
        } else {
          const varValue = (session.variables.get(varName) || '').toString().toLowerCase()
          switch (operator) {
            case 'equals':
              condResult = varValue === compareValue
              break
            case 'contains':
              condResult = varValue.includes(compareValue)
              break
            case 'startsWith':
              condResult = varValue.startsWith(compareValue)
              break
            case 'notEquals':
              condResult = varValue !== compareValue
              break
            case 'gt':
              condResult = parseFloat(varValue) > parseFloat(compareValue)
              break
            case 'lt':
              condResult = parseFloat(varValue) < parseFloat(compareValue)
              break
            case 'isEmpty':
              condResult = !varValue || varValue.trim() === ''
              break
            case 'notEmpty':
              condResult = varValue && varValue.trim() !== ''
              break
          }
        }

        const handle = condResult ? 'true' : 'false'
        const edge = workflow.edges.find(e => e.source === nodeId && e.sourceHandle === handle)
        if (edge) {
          await WorkflowEngine._executeNode(session, workflow, edge.target, message, pushName, msgKey, whatsapp)
        } else {
          await advance()
        }
        break
      }

      case 'menu': {
        const options = node.data.options || []
        const menuMessage = WorkflowEngine._replaceVariables(
          node.data.message || 'Escolha uma opção:',
          session.variables
        )
        // Tenta interativo, fallback para texto
        let textMenu = menuMessage + '\n'
        options.forEach((opt, i) => {
          textMenu += `\n${i + 1}️⃣ ${opt.label}`
        })
        try {
          await whatsapp.sendMessageHuman(session.contactJid, textMenu, msgKey, node.data.delay || 1500)
        } catch (err) {
          console.error(`[WORKFLOW] erro menu: ${err.message}`)
        }
        session.waitingForReply = true
        await session.save()
        break
      }

      case 'delay': {
        const delayMs = (node.data.seconds || 2) * 1000
        await new Promise(r => setTimeout(r, delayMs))
        await advance()
        break
      }

      case 'setVariable': {
        const varName = node.data.variableName || 'custom'
        const varVal = WorkflowEngine._replaceVariables(node.data.value || '', session.variables)
        session.variables.set(varName, varVal)
        session.markModified('variables')
        await advance()
        break
      }

      case 'httpRequest': {
        try {
          const url = WorkflowEngine._replaceVariables(node.data.url || '', session.variables)
          const method = (node.data.method || 'GET').toUpperCase()
          const headers = node.data.headers || {}
          let body = node.data.body || ''
          if (body) body = WorkflowEngine._replaceVariables(body, session.variables)

          const fetchOpts = { method, headers: { 'Content-Type': 'application/json', ...headers } }
          if (method !== 'GET' && body) fetchOpts.body = body

          const resp = await fetch(url, fetchOpts)
          const data = await resp.text()
          const saveTo = node.data.responseVariable || 'http_response'
          try {
            session.variables.set(saveTo, JSON.parse(data))
          } catch {
            session.variables.set(saveTo, data)
          }
          session.markModified('variables')
        } catch (err) {
          console.error(`[WORKFLOW] http err: ${err.message}`)
          session.variables.set('http_error', err.message)
          session.markModified('variables')
        }
        await advance()
        break
      }

      case 'aiResponse': {
        // IA não implementada nesta versão — envia fallback se houver
        const fallbackMsg = node.data.fallbackMessage || ''
        if (fallbackMsg) {
          const txt = WorkflowEngine._replaceVariables(fallbackMsg, session.variables)
          try {
            await whatsapp.sendMessageHuman(session.contactJid, txt, msgKey, 1000)
          } catch (err) {
            /* */
          }
        }
        await advance()
        break
      }

      case 'addTag': {
        const tagName = WorkflowEngine._replaceVariables(node.data.tagName || '', session.variables)
          .trim()
          .toLowerCase()
        if (tagName) {
          await ContactTag.updateOne(
            { instanceId: session.instanceId, contactJid: session.contactJid },
            { $addToSet: { tags: tagName } },
            { upsert: true }
          )
        }
        await advance()
        break
      }

      case 'removeTag': {
        const tagName = WorkflowEngine._replaceVariables(node.data.tagName || '', session.variables)
          .trim()
          .toLowerCase()
        if (tagName) {
          await ContactTag.updateOne(
            { instanceId: session.instanceId, contactJid: session.contactJid },
            { $pull: { tags: tagName } }
          )
        }
        await advance()
        break
      }

      case 'gotoWorkflow': {
        const targetId = node.data.targetWorkflowId
        if (!targetId) {
          session.status = 'completed'
          await session.save()
          break
        }
        const target = await Workflow.findById(targetId)
        if (!target || !target.active) {
          session.status = 'completed'
          await session.save()
          break
        }
        session.status = 'completed'
        await session.save()

        const trig = target.nodes.find(n => n.type === 'trigger')
        if (!trig) break
        const nextId = WorkflowEngine._getNextNodeId(target, trig.id)
        if (!nextId) break

        const newSession = await WorkflowSession.create({
          workflowId: target._id,
          instanceId: session.instanceId,
          contactJid: session.contactJid,
          contactNumber: session.contactNumber,
          currentNodeId: trig.id,
          variables: Object.fromEntries(session.variables)
        })
        await WorkflowEngine._executeNode(newSession, target, nextId, message, pushName, msgKey, whatsapp)
        break
      }

      case 'end': {
        const endText = node.data.message
          ? WorkflowEngine._replaceVariables(node.data.message, session.variables)
          : ''
        if (endText) {
          try {
            await whatsapp.sendMessageHuman(session.contactJid, endText, msgKey, node.data.delay || 1000)
          } catch (err) {
            /* */
          }
        }
        session.status = 'completed'
        await session.save()
        break
      }

      default:
        await advance()
    }
  }

  static _matchTrigger(triggerData, message, isNewContact) {
    const triggerType = triggerData.triggerType || 'all'
    const triggerValue = (triggerData.triggerValue || '').toLowerCase()
    const msgLower = message.toLowerCase()
    switch (triggerType) {
      case 'keyword':
        return msgLower === triggerValue
      case 'contains':
        return msgLower.includes(triggerValue)
      case 'startsWith':
        return msgLower.startsWith(triggerValue)
      case 'welcome':
        return isNewContact
      case 'all':
        return true
      default:
        return false
    }
  }

  static _getNextNodeId(workflow, currentNodeId) {
    const edge = workflow.edges.find(e => e.source === currentNodeId && !e.sourceHandle)
    if (edge) return edge.target
    const anyEdge = workflow.edges.find(e => e.source === currentNodeId)
    return anyEdge ? anyEdge.target : null
  }

  static _replaceVariables(text, variables) {
    let result = text
    if (variables instanceof Map) {
      variables.forEach((value, key) => {
        const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value || '')
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), valStr)
      })
    } else if (variables && typeof variables === 'object') {
      Object.entries(variables).forEach(([k, v]) => {
        const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v || '')
        result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), valStr)
      })
    }
    return result
  }

  static async _processMenuResponse(session, workflow, node, message, pushName, msgKey, whatsapp) {
    const options = node.data.options || []
    const choice = message.trim()
    let matched = null
    const choiceNum = parseInt(choice) - 1
    if (!isNaN(choiceNum) && choiceNum >= 0 && choiceNum < options.length) {
      matched = options[choiceNum]
    } else {
      matched = options.find(o => o.label.toLowerCase() === choice.toLowerCase())
    }
    if (!matched) matched = options.find(o => o.id === choice)

    if (matched) {
      session.variables.set('menu_escolha', matched.label)
      session.markModified('variables')
      const edge = workflow.edges.find(e => e.source === node.id && e.sourceHandle === matched.id)
      if (edge) {
        await WorkflowEngine._executeNode(session, workflow, edge.target, message, pushName, msgKey, whatsapp)
        return
      }
      const fallback = WorkflowEngine._getNextNodeId(workflow, node.id)
      if (fallback) {
        await WorkflowEngine._executeNode(session, workflow, fallback, message, pushName, msgKey, whatsapp)
      } else {
        session.status = 'completed'
        await session.save()
      }
      return
    }

    if (node.data.retryOnInvalid !== false) {
      const retryMsg = node.data.invalidMessage || '❌ Opção inválida. Escolha novamente:'
      let retryText = retryMsg + '\n'
      options.forEach((opt, i) => {
        retryText += `\n${i + 1}️⃣ ${opt.label}`
      })
      try {
        await whatsapp.sendMessageHuman(session.contactJid, retryText, msgKey, 1000)
      } catch (err) {
        /* */
      }
      session.waitingForReply = true
      await session.save()
    } else {
      const fallback = WorkflowEngine._getNextNodeId(workflow, node.id)
      if (fallback) {
        await WorkflowEngine._executeNode(session, workflow, fallback, message, pushName, msgKey, whatsapp)
      } else {
        session.status = 'completed'
        await session.save()
      }
    }
  }
}

module.exports = WorkflowEngine
