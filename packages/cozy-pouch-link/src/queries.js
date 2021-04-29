// https://github.com/pouchdb/pouchdb/issues/7011
const LIMIT_BUG = 999
const ADAPTERS_WITH_LIMIT_BUG = ['cordova-sqlite', 'websql']

const isAdapterBugged = adapterName => {
  return ADAPTERS_WITH_LIMIT_BUG.includes(adapterName)
}

const updateDocsInBatch = async (db, nDocs, nUpdatesPerDoc) => {
  const docs = await getDocs(db, 'allDocs', { limit: nDocs })
  console.log('docs : ', docs)
  for (let i = 0; i < nUpdatesPerDoc; i++) {
    const newDocs = docs.rows.map(doc => {
      return { ...doc, fake: 'faky_' + i.toString() }
    })
    console.log('update in bulk docs... ', newDocs)
    await db.bulkDocs(newDocs)
  }
  console.log(`${nDocs} docs with ${nUpdatesPerDoc} updates each`)
}

const queryPouch = async (db, selector, sort, index, limit = 100) => {
  const start = new Date()
  const query = await db.find({ selector, sort, use_index: index, limit })
  const end = new Date()
  console.log('query took ', end - start)
  console.log('query : ', query)
}

window.updateDocsInBatch = updateDocsInBatch
window.queryPouch = queryPouch

export const getDocs = async (db, fct, options = {}) => {
  // allDocs return an error when limit is null
  if (options.limit === null) delete options.limit
  const limit = options.limit
  const field = fct === 'allDocs' ? 'rows' : 'docs'

  if (isAdapterBugged(db.adapter)) {
    if (limit === undefined || limit > LIMIT_BUG) {
      options.limit = LIMIT_BUG
      options.skip = options.skip || 0
    }
  }
  console.log('options in queries  : ', options)
  const startFind = new Date()
  const data = await db[fct](options)
  const endFind = new Date()
  if (data.docs) {
    console.log(
      `PouchQueries: find took ${endFind - startFind} ms for ${
        data.docs.length
      } docs on query ${JSON.stringify(options)}`
    )
  } else if (data.rows) {
    console.log(
      `PouchQueries: all_docs took ${endFind - startFind} ms for ${
        data.rows.length
      } docs on query ${JSON.stringify(options)}`
    )
  }

  if (data[field].length === options.limit) {
    options.skip = (options.skip ? options.skip : 0) + options.limit
    options.limit = limit ? limit - options.limit : undefined
    if (options.limit > 0 || options.limit === undefined) {
      console.log('should next')
      const next = await getDocs(db, fct, options)

      return { ...data, [field]: [...data[field], ...next[field]] }
    }
  }

  return data
}

export const ensureIndex = async (db, options) => {
  console.log('go create index')
  const startIdx = new Date()
  const index = await db.createIndex({ index: options.index })
  const endIdx = new Date()
  console.log(
    `PouchQueries: index took ${endIdx - startIdx} ms for ${JSON.stringify(
      index
    )}}`
  )
  return index
}
