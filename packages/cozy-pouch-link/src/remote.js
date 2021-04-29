export const fetchRemoteInstance = async (url, params = {}) => {
  console.log('query baseUrl : ', url)
  const username = url.username
  const password = url.password

  console.log('params : ', params)
  Object.keys(params).forEach(key => {
    url.searchParams.set(key, params[key])
  })
  const fetchUrl = `${url.protocol}//${url.href.substring(
    url.href.indexOf('@') + 1
  )}`
  const headers = new Headers()
  headers.append('Accept', 'application/json')
  headers.append('Content-Type', 'application/json')
  headers.append('Authorization', 'Basic ' + btoa(username + ':' + password))
  console.log('fetch url : ', fetchUrl)
  const resp = await fetch(fetchUrl, { headers })
  const data = await resp.json()
  if (resp.ok) {
    return data
  }
  return null
}

export const fetchRemoteLastSequence = async baseUrl => {
  const remoteUrl = new URL(`${baseUrl}/_changes`)
  const res = await fetchRemoteInstance(remoteUrl, {
    limit: 1,
    descending: true
  })
  console.log('get last seq : ', res.last_seq)
  return res.last_seq
}

// http://cozy.tools:8080/data/io.cozy.files/_local/xt2is8FV14Edd2.C8WbUXA%3D%3D?
