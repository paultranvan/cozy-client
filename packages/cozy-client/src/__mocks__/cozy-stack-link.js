const collectionMock = {
  all: jest.fn(() => Promise.resolve()),
  find: jest.fn(() => Promise.resolve())
}
const linkMock = jest.fn().mockImplementation(() => {
  return { collection: jest.fn(() => collectionMock) }
})
export default linkMock
