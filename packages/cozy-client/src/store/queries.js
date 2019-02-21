import mapValues from 'lodash/mapValues'
import union from 'lodash/union'
import difference from 'lodash/difference'
import intersection from 'lodash/intersection'
import isPlainObject from 'lodash/isPlainObject'

import { getDocumentFromSlice } from './documents'
import { isReceivingMutationResult } from './mutations'
import { properId } from './helpers'
import sift from 'sift'
import get from 'lodash/get'
const INIT_QUERY = 'INIT_QUERY'
const RECEIVE_QUERY_RESULT = 'RECEIVE_QUERY_RESULT'
const RECEIVE_QUERY_ERROR = 'RECEIVE_QUERY_ERROR'

export const isQueryAction = action =>
  [INIT_QUERY, RECEIVE_QUERY_RESULT, RECEIVE_QUERY_ERROR].indexOf(
    action.type
  ) !== -1

export const isReceivingData = action => action.type === RECEIVE_QUERY_RESULT

// reducers
const queryInitialState = {
  id: null,
  definition: null,
  fetchStatus: 'pending',
  lastFetch: null,
  lastUpdate: null,
  lastError: null,
  hasMore: false,
  count: 0,
  data: []
}

const query = (state = queryInitialState, action) => {
  switch (action.type) {
    case INIT_QUERY:
      return {
        ...state,
        id: action.queryId,
        definition: action.queryDefinition,
        fetchStatus: 'loading'
      }
    case RECEIVE_QUERY_RESULT: {
      const response = action.response
      const common = {
        fetchStatus: 'loaded',
        lastFetch: Date.now(),
        lastUpdate: Date.now()
      }
      if (!response.data) {
        return state
      }
      if (!Array.isArray(response.data)) {
        return {
          ...state,
          ...common,
          hasMore: false,
          count: 1,
          data: [properId(response.data)]
        }
      }
      return {
        ...state,
        ...common,
        hasMore: response.next !== undefined ? response.next : state.hasMore,
        count:
          response.meta && response.meta.count
            ? response.meta.count
            : response.data.length,
        data:
          response.skip === 0
            ? response.data.map(properId)
            : [...state.data, ...response.data.map(properId)]
      }
    }
    case RECEIVE_QUERY_ERROR:
      return {
        ...state,
        id: action.queryId,
        fetchStatus: 'failed',
        lastError: action.error
      }
    default:
      return state
  }
}

export const convert$gtNullSelectors = selector => {
  const result = {}
  for (const [key, value] of Object.entries(selector)) {
    const convertedValue = isPlainObject(value)
      ? convert$gtNullSelectors(value)
      : value
    const convertedKey =
      key === '$gt' && convertedValue === null ? '$gtnull' : key

    result[convertedKey] = convertedValue
  }
  return result
}

const getSelectorFilterFn = queryDefinition => {
  if (queryDefinition.selector) {
    // sift does not work like couchdb when using { $gt: null } as a selector, so we use a custom operator
    sift.use({
      $gtnull: (selectorValue, actualValue) => {
        return !!actualValue
      }
    })
    return sift(convert$gtNullSelectors(queryDefinition.selector))
  } else if (queryDefinition.id) {
    return sift({ _id: queryDefinition.id })
  } else {
    return null
  }
}

const getQueryDocumentsChecker = query => {
  const qdoctype = query.definition.doctype
  const selectorFilterFn = getSelectorFilterFn(query.definition)
  return datum => {
    const ddoctype = datum._type
    if (ddoctype !== qdoctype) return false
    if (selectorFilterFn && !selectorFilterFn(datum)) {
      return false
    }
    if (datum._deleted) return false
    return true
  }
}

const updateData = (query, newData) => {
  const isFulfilled = getQueryDocumentsChecker(query)
  const matchedIds = newData.filter(doc => isFulfilled(doc)).map(properId)
  const unmatchedIds = newData.filter(doc => !isFulfilled(doc)).map(properId)
  const originalIds = query.data
  const toRemove = intersection(originalIds, unmatchedIds)
  const toAdd = difference(matchedIds, originalIds)
  const toUpdate = intersection(originalIds, matchedIds)

  const changed = toRemove.length || toAdd.length || toUpdate.length

  const updatedData = difference(union(originalIds, toAdd), toRemove)

  return {
    ...query,
    data: updatedData,
    count: updatedData.length,
    lastUpdate: changed ? Date.now() : query.lastUpdate
  }
}

const autoQueryUpdater = action => query => {
  let data = get(action, 'response.data') || get(action, 'definition.document')

  if (!data) return query

  if (!Array.isArray(data)) {
    data = [data]
  }
  if (!data.length) {
    return query
  }
  if (query.definition.doctype !== data[0]._type) {
    return query
  }
  return updateData(query, data)
}

const manualQueryUpdater = (action, documents) => query => {
  const updateQueries = action.updateQueries
  const response = action.response
  const updater = updateQueries[query.id]
  if (!updater) {
    return query
  }

  const doctype = query.definition.doctype
  const oldData = query.data
  const oldDocs = mapIdsToDocuments(documents, doctype, oldData)
  const newData = updater(oldDocs, response)
  const newDataIds = newData.map(properId)
  return {
    ...query,
    data: newDataIds,
    count: newDataIds.length,
    lastUpdate: Date.now()
  }
}

const queries = (
  state = {},
  action,
  nextDocuments = {},
  haveDocumentsChanged = true
) => {
  if (action.type == INIT_QUERY) {
    return {
      ...state,
      [action.queryId]: query(state[action.queryId], action)
    }
  }
  if (isQueryAction(action)) {
    const updater = autoQueryUpdater(action)
    return mapValues(state, queryState => {
      if (queryState.id == action.queryId) {
        return query(queryState, action)
      } else if (haveDocumentsChanged) {
        return updater(queryState)
      } else {
        return queryState
      }
    })
  }
  if (isReceivingMutationResult(action)) {
    const updater = action.updateQueries
      ? manualQueryUpdater(action, nextDocuments)
      : autoQueryUpdater(action)
    return mapValues(state, updater)
  }
  return state
}
export default queries

// actions
export const initQuery = (queryId, queryDefinition) => {
  if (!queryDefinition.doctype) {
    throw new Error('Cannot init query with no doctype')
  }
  return {
    type: INIT_QUERY,
    queryId,
    queryDefinition
  }
}

export const receiveQueryResult = (queryId, response, options = {}) => ({
  type: RECEIVE_QUERY_RESULT,
  queryId,
  response,
  ...options
})

export const receiveQueryError = (queryId, error) => ({
  type: RECEIVE_QUERY_ERROR,
  queryId,
  error
})

// selectors
const mapIdsToDocuments = (documents, doctype, ids) =>
  ids.map(id => getDocumentFromSlice(documents, doctype, id))

export const getQueryFromSlice = (state, queryId, documents) => {
  if (!state || !state[queryId]) {
    return { ...queryInitialState, data: null }
  }
  const query = state[queryId]
  return documents
    ? {
        ...query,
        data: mapIdsToDocuments(documents, query.definition.doctype, query.data)
      }
    : query
}
