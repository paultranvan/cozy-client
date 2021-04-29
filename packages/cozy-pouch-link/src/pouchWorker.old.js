// block for `time` ms, then return the number of loops we could run in that time:

// https://github.com/pouchdb/pouchdb/issues/7011
const LIMIT_BUG = 999
const ADAPTERS_WITH_LIMIT_BUG = ['cordova-sqlite', 'websql']

const isAdapterBugged = adapterName => {
  return ADAPTERS_WITH_LIMIT_BUG.includes(adapterName)
}


export const getDocs = async (db, fct, options = {}) => {
  console.log('get docs worker')
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
  
  console.log('options : ', options)
  console.log('db : ', db)
  const data = await db[fct](options)
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