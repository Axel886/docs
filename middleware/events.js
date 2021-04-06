const express = require('express')
const { omit } = require('lodash')
const Ajv = require('ajv')
const schema = require('../lib/schema-event')
const FailBot = require('../lib/failbot')

const OMIT_FIELDS = ['type', 'token']

const ajv = new Ajv()

const router = express.Router()

router.post('/', async function postEvents (req, res, next) {
  const isDev = process.env.NODE_ENV === 'development'
  const fields = omit(req.body, '_csrf')

  if (!ajv.validate(schema, fields)) {
    if (isDev) console.log(ajv.errorsText())
    return res.status(400).json({})
  }

  if (req.hydro.maySend()) {
    // intentionally don't await this async request
    // so that the http response afterwards is sent immediately
    req.hydro.publish(
      req.hydro.schemas[fields.type],
      omit(fields, OMIT_FIELDS)
    ).then(async (hydroRes) => {
      // Track hydro exceptions in Sentry, but don't track 503s because we can't do anything about service availability
      if (!hydroRes.ok && hydroRes.status !== 503) {
        const err = new Error(`Hydro request failed: ${hydroRes.statusText}`)
        err.status = hydroRes.status
        err.path = fields.path

        await FailBot.report(err, {
          path: fields.path,
          hydroStatus: hydroRes.status,
          hydroText: hydroRes.statusText
        })

        throw err
      }
    }).catch((e) => {
      if (isDev) console.error(e)
    })
  }

  return res.status(200).json({})
})

module.exports = router
