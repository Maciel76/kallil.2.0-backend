const jwt = require('jsonwebtoken')
const User = require('../models/User')

const auth = async (req, res, next) => {
  let token = req.header('Authorization')?.replace('Bearer ', '')

  // Fallback: token via query string (necessário para SSE/EventSource)
  if (!token && req.query.token) {
    token = req.query.token
  }

  if (!token) {
    return res.status(401).json({ message: 'Acesso negado. Token não fornecido.' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.id)
    if (!user || !user.ativo) {
      return res.status(401).json({ message: 'Usuário inativo ou não encontrado.' })
    }

    req.userId = user.getUserIdEfetivo()
    req.userRealId = user._id
    req.userRole = user.role
    next()
  } catch (error) {
    res.status(401).json({ message: 'Token inválido.' })
  }
}

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({ message: 'Acesso não autorizado.' })
    }
    next()
  }
}

module.exports = auth
module.exports.authorize = authorize
