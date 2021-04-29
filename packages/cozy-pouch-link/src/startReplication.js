import { default as helpers } from './helpers'
import startsWith from 'lodash/startsWith'
import generateReplicationId from 'pouchdb-generate-replication-id'
import logger from './logger'
import { fetchRemoteInstance } from './remote'
const { isDesignDocument, isDeletedDocument } = helpers

export const humanTimeDelta = timeMs => {
  let cur = timeMs
  let unitIndex = 0
  let str = ''
  while (cur >= TIME_UNITS[unitIndex][1]) {
    let unit = TIME_UNITS[unitIndex]
    const int = Math.round(cur / unit[1])
    const rest = cur % unit[1]
    str = `${rest}${unit[0]}` + str
    cur = int
    unitIndex++
  }
  const lastUnit = TIME_UNITS[unitIndex]
  str = `${cur}${lastUnit[0]}` + str
  return str
}
const TIME_UNITS = [['ms', 1000], ['s', 60], ['m', 60], ['h', 24]]

/**
 * startReplication - Create a cancellable promise for replication with default options
 *
 * @private
 * @param {object} pouch                 Pouch database instance
 * @param {object} replicationOptions Any option supported by the Pouch replication API (https://pouchdb.com/api.html#replication)
 * @param {string} replicationOptions.strategy The direction of the replication. Can be "fromRemote",  "toRemote" or "sync"
 * @param {Function} getReplicationURL A function that should return the remote replication URL
 *
 * @returns {Promise} A cancelable promise that resolves at the end of the replication
 */
export const startReplication = (
  pouch,
  replicationOptions,
  getReplicationURL
) => {
  let replication
  const start = new Date()
  const promise = new Promise(async (resolve, reject) => {
    const url = getReplicationURL()
    console.log('replication url : ', url)
    const {
      strategy,
      initialReplication,
      warmupQueries,
      filter,
      ...customReplicationOptions
    } = replicationOptions
    const options = {
      batch_size: 1000 // we have mostly small documents
      //...customReplicationOptions
    }
    console.log('start replication with opts ', replicationOptions)
    window.repOpts = options
    window.customReplicationOptions = customReplicationOptions
    let replication
    if (initialReplication && strategy !== 'toRemote') {
      // For the first remote->local replication, we manually replicate all docs
      // as it avoids to replicate all revs history
      const start = new Date()
      const docs = await replicateAllDocs(pouch, url)
      const end = new Date()
      console.log(
        `PouchManager: init replication  took ${humanTimeDelta(
          end - start
        )} for ${docs.length} docs`
      )
      return resolve(docs)
    }
    console.log('go replication anyway ?!')
    if (strategy === 'fromRemote')
      replication = pouch.replicate.from(url, options)
    else if (strategy === 'toRemote')
      replication = pouch.replicate.to(url, options)
    else replication = pouch.sync(url, options)

    const docs = {}

    replication.on('change', infos => {
      //! Since we introduced the concept of strategy we can use
      // PouchDB.replicate or PouchDB.sync. But both don't share the
      // same API for the change's event.
      // See https://pouchdb.com/api.html#replication
      // and https://pouchdb.com/api.html#sync (see example response)
      const change = infos.change ? infos.change : infos
      console.log('change : ', change)
      if (change.docs) {
        change.docs
          .filter(doc => !isDesignDocument(doc) && !isDeletedDocument(doc))
          //.map(doc => (doc._revisions = manualRev(doc)))
          .forEach(doc => {
            docs[doc._id] = doc
          })
      }
    })
    replication.on('error', reject).on('complete', infos => {
      console.log('PouchManager : replication infos : ', infos)
      const end = new Date()
      console.log(
        `PouchManager: replication console for ${url} took ${humanTimeDelta(
          end - start
        )} for ${infos.docs_written} docs`
      )
      console.log('actual saved docs : ', Object.keys(docs).length)
      if (process.env.NODE_ENV !== 'production') {
        logger.info(
          `PouchManager: replication for ${url} took ${humanTimeDelta(
            end - start
          )}`
        )
      }
      resolve(Object.values(docs))
    })
  })

  const cancel = () => {
    if (replication) {
      replication.cancel()
    }
  }

  promise.cancel = cancel
  return promise
}

const filterDocs = docs => {
  return docs
    .map(doc => doc.doc)
    .filter(doc => !doc._deleted && !startsWith(doc._id, '_design'))
}

export const replicateAllDocs = async (db, baseUrl) => {
  const remoteUrl = new URL(`${baseUrl}/_all_docs`)
  const batchSize = 1000
  let hasMore = true
  let startDocId
  let docs

  while (hasMore) {
    if (!startDocId) {
      // first run
      const res = await fetchRemoteInstance(remoteUrl, {
        limit: batchSize,
        include_docs: true
      })
      docs = filterDocs(res.rows)
      console.log('res length: ', docs.length)
      if (docs.length === 0) {
        hasMore = false
      } else {
        startDocId = docs[docs.length - 1]._id
        if (docs.length < batchSize) {
          hasMore = false
        }
        const resInsert = await insertDocsBatch(db, docs)
        console.log('res bulk insert : ', resInsert)
      }
    } else {
      const res = await fetchRemoteInstance(remoteUrl, {
        include_docs: true,
        limit: batchSize,
        startkey_docid: startDocId
      })
      const filteredDocs = filterDocs(res.rows)
      console.log('res length: ', res.rows.length)
      if (filteredDocs.length < 2) {
        return docs
      }
      filteredDocs.shift() // Remove first element, already included in previous request
      startDocId = filteredDocs[filteredDocs.length - 1]._id
      await insertDocsBatch(db, filteredDocs)
      docs = docs.concat(filteredDocs)
      if (res.rows.length < batchSize) {
        hasMore = false
      }
    }
  }
  console.log('docs retrieved : ', docs.length)
  return docs
}

const insertDocsBatch = async (db, docs) => {
  return db.bulkDocs(docs, { new_edits: false })
}

window.generateReplicationId = generateReplicationId