import PouchDB from 'pouchdb-browser'
import PouchDBFind from 'pouchdb-find'
import { getDocs, ensureIndex } from './queries'
PouchDB.plugin(PouchDBFind)

onmessage = async function(e) {
  //console.log('receive message : ', e.data)
  if (e.data.pouchOptions.adapter === 'indexeddb') {
    PouchDB.plugin(require('pouchdb-adapter-indexeddb').default)
  }
  const db = new PouchDB(e.data.dbName, e.data.pouchOptions)

  const query = e.data.query
  const options = e.data.options
  console.log('worker query : ', query)
  try {
    let res
    if (query === 'find' || query === 'allDocs') {
      res = await getDocs(db, query, options)
      e.ports[0].postMessage({ result: res })
    } else if (query === 'createIndex') {
      res = await ensureIndex(db, options)
    }
    //console.log('resworker  : ', res)
    e.ports[0].postMessage({ result: res })
  } catch (error) {
    e.ports[0].postMessage({ error })
  }
}
