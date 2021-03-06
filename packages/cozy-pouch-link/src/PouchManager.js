/** Handles the lifecycle of several pouches */

import PouchDB from 'pouchdb'
import fromPairs from 'lodash/fromPairs'
import map from 'lodash/map'
import zip from 'lodash/zip'
import * as promises from './promises'
import { isDesignDocument, isDeletedDocument } from './helpers'
import { isMobileApp } from 'cozy-device-helper'

const DEFAULT_DELAY = 30 * 1000

/* Create a cancellable promise for replication with default options */
const startReplication = (pouch, getReplicationURL) => {
  let replication
  const promise = new Promise((resolve, reject) => {
    const url = getReplicationURL()
    replication = pouch.sync(url, {
      batch_size: 1000 // we have mostly small documents
    })
    const docs = {}
    replication.on('change', ({ change }) => {
      if (change.docs) {
        change.docs
          .filter(doc => !isDesignDocument(doc) && !isDeletedDocument(doc))
          .forEach(doc => {
            docs[doc._id] = doc
          })
      }
    })
    replication.on('error', reject).on('complete', () => {
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

/**
 * - Creates/Destroys the pouches
 * - Replicates periodically
 */
export default class PouchManager {
  constructor(doctypes, options) {
    this.pouches = fromPairs(
      doctypes.map(doctype => [doctype, new PouchDB(doctype)])
    )
    this.options = options
    this.getReplicationURL = options.getReplicationURL
    this.listenerLaunched = false
  }

  addListener() {
    if (isMobileApp() && !this.listenerLaunched) {
      document.addEventListener(
        'pause',
        () => this.stopReplicationLoop(),
        false
      )
      document.addEventListener(
        'resign',
        () => this.stopReplicationLoop(),
        false
      )
      document.addEventListener(
        'resume',
        () => this.startReplicationLoop(),
        false
      )
      this.listenerLaunched = true
    }
  }

  removeListener() {
    if (this.listenerLaunched) {
      document.removeEventListener(
        'pause',
        () => this.stopReplicationLoop(),
        false
      )
      document.removeEventListener(
        'resign',
        () => this.stopReplicationLoop(),
        false
      )
      document.removeEventListener(
        'resume',
        () => this.startReplicationLoop(),
        false
      )
      this.listenerLaunched = false
    }
  }

  destroy() {
    this.stopReplicationLoop()
    this.removeListener()
    return Promise.all(
      Object.values(this.pouches).map(pouch => pouch.destroy())
    )
  }

  /** Starts periodic syncing of the pouches */
  async startReplicationLoop(delay) {
    if (this._stopReplicationLoop) {
      return this._stopReplicationLoop
    }
    console.info('Start replication loop')
    delay = delay || this.options.replicationDelay || DEFAULT_DELAY
    this._stopReplicationLoop = promises.setInterval(() => {
      if (window.navigator.onLine) {
        this.replicateOnce()
      } else {
        console.info('The device is offline replication is abort')
      }
    }, delay)
    this.addListener()
    return this._stopReplicationLoop
  }

  /** Stop periodic syncing of the pouches */
  stopReplicationLoop() {
    if (this._stopReplicationLoop) {
      console.info('Stop replication loop')
      this.cancelCurrentReplications()
      this._stopReplicationLoop()
      this._stopReplicationLoop = null
    }
  }

  /** Starts replication */
  async replicateOnce() {
    this.replications = map(this.pouches, (pouch, doctype) => {
      const getReplicationURL = () => this.getReplicationURL(doctype)
      return startReplication(pouch, getReplicationURL)
    })
    const doctypes = Object.keys(this.pouches)
    const promises = Object.values(this.replications)
    try {
      const res = await Promise.all(promises)
      if (this.options.onSync) {
        const doctypeUpdates = fromPairs(zip(doctypes, res))
        this.options.onSync(doctypeUpdates)
      }
      return res
    } catch (err) {
      // On error, replication stops, it needs to be started
      // again manually by the owner of PouchManager
      this.stopReplicationLoop()
      console.warn('Error during replication', err)
      if (this.options.onError) {
        this.options.onError(err)
      }
    }
  }

  cancelCurrentReplications() {
    if (!this.replications) {
      console.warn('No current replications')
      return
    }
    Object.values(this.replications).forEach(replication => {
      return replication.cancel()
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
}
