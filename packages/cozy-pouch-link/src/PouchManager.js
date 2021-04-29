import PouchDB from 'pouchdb-browser'
import fromPairs from 'lodash/fromPairs'
import forEach from 'lodash/forEach'
import get from 'lodash/get'
import map from 'lodash/map'
import zip from 'lodash/zip'
import startsWith from 'lodash/startsWith'
import Loop from './loop'
import { isMobileApp } from 'cozy-device-helper'
import logger from './logger'

import {
  startReplication,
  humanTimeDelta,
  getAllDocsBatch
} from './startReplication'
const DEFAULT_DELAY = 30 * 1000

export const LOCALSTORAGE_SYNCED_KEY = 'cozy-client-pouch-link-synced'
export const LOCALSTORAGE_WARMUPEDQUERIES_KEY =
  'cozy-client-pouch-link-warmupedqueries'
const LOCALSTORAGE_NEXTREPLICATIONSEQUENCE_KEY =
  'cozy-client-pouch-link-nextreplicationsequence'
/**
 * @param {QueryDefinition} query
 * @returns {string} alias
 */
const getQueryAlias = query => {
  return query.options.as
}

/**
 * Handles the lifecycle of several pouches
 *
 * - Creates/Destroys the pouches
 * - Replicates periodically
 */
class PouchManager {
  constructor(doctypes, options) {
    this.options = options
    const pouchPlugins = get(options, 'pouch.plugins', [])
    const pouchOptions = get(options, 'pouch.options', {})

    forEach(pouchPlugins, plugin => PouchDB.plugin(plugin))
    this.pouches = fromPairs(
      doctypes.map(doctype => [
        doctype,
        new PouchDB(this.getDatabaseName(doctype), pouchOptions)
      ])
    )
    window.pouch = this.pouches
    this.syncedDoctypes = this.getPersistedSyncedDoctypes()
    this.warmedUpQueries = this.getPersistedWarmedUpQueries()
    this.getReplicationURL = options.getReplicationURL
    this.doctypesReplicationOptions = options.doctypesReplicationOptions || {}
    this.listenerLaunched = false

    // We must ensure databases exist on the remote before
    // starting replications
    this.ensureDatabasesExistDone = false

    this.startReplicationLoop = this.startReplicationLoop.bind(this)
    this.stopReplicationLoop = this.stopReplicationLoop.bind(this)
    this.replicateOnce = this.replicateOnce.bind(this)
    this.executeQuery = this.options.executeQuery
  }

  addListeners() {
    if (!this.listenerLaunched) {
      if (isMobileApp()) {
        document.addEventListener('pause', this.stopReplicationLoop)
        document.addEventListener('resume', this.startReplicationLoop)
      }
      document.addEventListener('online', this.startReplicationLoop)
      document.addEventListener('offline', this.stopReplicationLoop)
      this.listenerLaunched = true
    }
  }

  removeListeners() {
    if (this.listenerLaunched) {
      if (isMobileApp()) {
        document.removeEventListener('pause', this.stopReplicationLoop)
        document.removeEventListener('resume', this.startReplicationLoop)
      }
      document.removeEventListener('online', this.startReplicationLoop)
      document.removeEventListener('offline', this.stopReplicationLoop)
      this.listenerLaunched = false
    }
  }

  destroy() {
    console.log('destroy the pouches')
    this.stopReplicationLoop()
    this.removeListeners()
    this.destroySyncedDoctypes()
    this.clearWarmedUpQueries()

    return Promise.all(
      Object.values(this.pouches).map(pouch => pouch.destroy())
    )
  }

  /**
   * Via a call to info() we ensure the database exist on the
   * remote side. This is done only once since after the first
   * call, we are sure that the databases have been created.
   */
  async ensureDatabasesExist() {
    if (this.ensureDatabasesExistDone) {
      return Promise.resolve()
    }
    return Promise.all(
      Object.values(this.pouches).map(pouch => pouch.info())
    ).then(() => {
      logger.info('PouchManager: ensure databases exist done')
      this.ensureDatabasesExistDone = true
    })
  }

  /** Starts periodic syncing of the pouches */
  async startReplicationLoop() {
    await this.ensureDatabasesExist()

    if (this.replicationLoop) {
      logger.warn('Replication loop already started')
      return
    }

    if (process.env.NODE_ENV !== 'production') {
      logger.info('PouchManager: Start replication loop')
    }
    const delay = this.options.replicationDelay || DEFAULT_DELAY
    this.replicationLoop = new Loop(this.replicateOnce, delay)
    this.replicationLoop.start()
    this.addListeners()
    return this.replicationLoop
  }

  /** Stop periodic syncing of the pouches */
  stopReplicationLoop() {
    if (this.replicationLoop) {
      logger.info('PouchManager: Stop replication loop')
      this.replicationLoop.stop()
      this.replicationLoop = null
    }
  }

  /**
   * If a replication is currently ongoing, will start a replication
   * just after it has finished. Otherwise it will start a replication
   * immediately
   */
  syncImmediately() {
    if (!this.replicationLoop) {
      logger.warn('No replication loop, cannot syncImmediately')
      return
    }
    this.replicationLoop.scheduleImmediateTask()
  }

  /** Starts replication */
  async replicateOnce() {
    if (!window.navigator.onLine) {
      logger.info(
        'PouchManager: The device is offline so the replication has been skipped'
      )
      return Promise.resolve()
    }

    logger.info('PouchManager: Starting replication iteration')

    // Creating each replication
    this.replications = map(this.pouches, async (pouch, doctype) => {
      logger.info('PouchManager: Starting replication for ' + doctype)

      const getReplicationURL = () => this.getReplicationURL(doctype)

      const initialReplication = !this.isSynced(doctype)
      const replicationFilter = doc => {
        return !startsWith(doc._id, '_design')
      }

      const replicationOptions = get(
        this.doctypesReplicationOptions,
        doctype,
        {}
      )
      replicationOptions.initialReplication = initialReplication
      replicationOptions.filter = replicationFilter

      const res = await startReplication(
        pouch,
        replicationOptions,
        getReplicationURL
      )
      /*if (isInitialReplicationForDoctype) {
        console.log('go compact')
        await this.compact(pouch)
      }*/
      if (initialReplication) {
        this.persistFirstReplicationDate()
      }
      console.log(
        'PouchManager: Replication for ' + doctype + ' ended with: ',
        res.length
      )
      this.addSyncedDoctype(doctype)
      this.checkToWarmupDoctype(doctype, replicationOptions)
      return res
    })

    // Waiting on each replication
    const doctypes = Object.keys(this.pouches)
    const promises = Object.values(this.replications)
    try {
      const res = await Promise.all(promises)

      if (process.env.NODE_ENV !== 'production') {
        logger.info('PouchManager: Replication ended')
      }

      if (this.options.onSync) {
        const doctypeUpdates = fromPairs(zip(doctypes, res))
        this.options.onSync(doctypeUpdates)
      }

      res.cancel = this.cancelCurrentReplications

      return res
    } catch (err) {
      this.handleReplicationError(err)
    }
  }

  handleReplicationError(err) {
    logger.warn('PouchManager: Error during replication', err)
    // On error, replication stops, it needs to be started
    // again manually by the owner of PouchManager
    this.stopReplicationLoop()
    if (this.options.onError) {
      this.options.onError(err)
    }
  }

  cancelCurrentReplications() {
    if (!this.replications) {
      logger.warn('PouchManager: No current replications')
      return
    }
    Object.values(this.replications).forEach(replication => {
      return replication.cancel && replication.cancel()
    })
  }

  waitForCurrentReplications() {
    if (!this.replications) {
      return Promise.resolve()
    }
    return Promise.all(Object.values(this.replications))
  }

  getPouch(doctype) {
    return this.pouches[doctype]
  }

  async compact(db) {
    try {
      let start = new Date()
      await db.compact()
      let end = new Date()
      console.log(`PouchManager: compaction took ${end - start} ms`)
    } catch (err) {
      logger.warn('PouchManager: Error during compaction', err)
    }
  }

  getPersistedSyncedDoctypes() {
    const item = window.localStorage.getItem(LOCALSTORAGE_SYNCED_KEY)

    // We check if the item in local storage is an array because we previously stored a boolean
    if (!item || !Array.isArray(JSON.parse(item))) {
      return []
    }

    return JSON.parse(item)
  }

  persistSyncedDoctypes() {
    window.localStorage.setItem(
      LOCALSTORAGE_SYNCED_KEY,
      JSON.stringify(this.syncedDoctypes)
    )
  }

  addSyncedDoctype(doctype) {
    if (!this.isSynced(doctype)) {
      console.log(`${doctype} synced!!`)
      this.syncedDoctypes.push(doctype)
      this.persistSyncedDoctypes()
    }
  }

  isSynced(doctype) {
    return this.syncedDoctypes.includes(doctype)
  }

  destroySyncedDoctypes() {
    this.syncedDoctypes = []
    window.localStorage.removeItem(LOCALSTORAGE_SYNCED_KEY)
  }

  persistNextReplicationSequence(sequence) {
    window.localStorage.setItem(
      LOCALSTORAGE_NEXTREPLICATIONSEQUENCE_KEY,
      sequence
    )
  }

  checkNextReplicationSequence() {
    const date = window.localStorage.getItem(
      LOCALSTORAGE_NEXTREPLICATIONSEQUENCE_KEY
    )
    return date
  }

  destroyNextReplicationDate() {
    const date = window.localStorage.removeItem(LOCALSTORAGE_NEXTREPLICATIONSEQUENCE_KEY)
    return date
  }

  getDatabaseName(doctype) {
    return `${this.options.prefix}_${doctype}`
  }

  async warmupQueries(doctype, queries) {
    if (!this.warmedUpQueries[doctype]) this.warmedUpQueries[doctype] = []
    try {
      let start = new Date()
      await Promise.all(
        queries.map(async query => {
          const def = getQueryAlias(query)
          if (!this.warmedUpQueries[doctype].includes(def)) {
            await this.executeQuery(query.definition().toDefinition())
            this.warmedUpQueries[doctype].push(def)
          }
        })
      )
      let end = new Date()
      console.log(
        `PouchManager: warmup queries took ${humanTimeDelta(end - start)}`
      )
      this.persistWarmedUpQueries()
      logger.log('PouchManager: warmupQueries for ' + doctype + ' are done')
    } catch (err) {
      delete this.warmedUpQueries[doctype]
    }
  }

  // Queries are warmed up only once per instantiation of the PouchManager. Since
  // the PouchManager lives during the complete lifecycle of the app, warm up
  // happens only on app start / restart.
  checkToWarmupDoctype(doctype, replicationOptions) {
    if (!this.warmedUpQueries[doctype] && replicationOptions.warmupQueries) {
      this.warmupQueries(doctype, replicationOptions.warmupQueries)
    }
  }

  persistWarmedUpQueries() {
    window.localStorage.setItem(
      LOCALSTORAGE_WARMUPEDQUERIES_KEY,
      JSON.stringify(this.warmedUpQueries)
    )
  }

  areQueriesWarmedUp(doctype, queries) {
    const persistWarmedUpQueries = this.getPersistedWarmedUpQueries()
    return queries.every(
      query =>
        persistWarmedUpQueries[doctype] &&
        persistWarmedUpQueries[doctype].includes(getQueryAlias(query))
    )
  }

  getPersistedWarmedUpQueries() {
    const item = window.localStorage.getItem(LOCALSTORAGE_WARMUPEDQUERIES_KEY)
    if (!item) {
      return {}
    }
    return JSON.parse(item)
  }

  clearWarmedUpQueries() {
    this.warmedUpQueries = {}
    window.localStorage.removeItem(LOCALSTORAGE_WARMUPEDQUERIES_KEY)
  }
}

export default PouchManager
