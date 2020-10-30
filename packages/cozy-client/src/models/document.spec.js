import * as Document from './document'
import * as qualificationModel from '../assets/qualifications.json'

describe('document qualification', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn')
    jest.spyOn(console, 'info')
  })

  afterEach(() => {
    console.warn.mockRestore()
    console.info.mockRestore()
  })

  it('should get the correct qualification by the label', () => {
    const qualification = Document.getQualificationByLabel(
      'national_id_card'
    ).toQualification()
    expect(qualification.label).toEqual('national_id_card')
    expect(qualification.sourceCategory).toEqual('gov')
    expect(qualification.sourceSubCategory).toEqual('civil_registration')
    expect(qualification.subjects).toEqual(['identity'])
  })
  it('should get the file qualification', () => {
    const qualification = {
      purpose: 'invoice',
      subjects: ['subscription']
    }
    const fileDoc = {
      _id: '123',
      metadata: { qualification }
    }
    const fileQualification = Document.getQualification(fileDoc)
    expect(fileQualification).toEqual(qualification)
  })

  it('should set the correct qualification', () => {
    const fileDoc = {
      _id: '123',
      metadata: {
        datetime: '2020-01-01T20:38:04Z'
      }
    }
    let qualification = {
      label: 'health_invoice',
      purpose: 'invoice',
      sourceCategory: 'health'
    }
    Document.setQualification(fileDoc, qualification)
    expect(fileDoc).toEqual({
      _id: '123',
      metadata: {
        datetime: '2020-01-01T20:38:04Z',
        qualification: {
          label: 'health_invoice',
          purpose: 'invoice',
          sourceCategory: 'health'
        }
      }
    })

    qualification = Document.getQualificationByLabel('other_identity_document')
      .setPurpose('attestation')
      .setSourceCategory('gov')
      .setSourceSubCategory('civil_registration')
      .setSubjects(['identity'])
    Document.setQualification(fileDoc, qualification)
    expect(fileDoc).toEqual({
      _id: '123',
      metadata: {
        datetime: '2020-01-01T20:38:04Z',
        qualification: {
          label: 'other_identity_document',
          purpose: 'attestation',
          sourceCategory: 'gov',
          sourceSubCategory: 'civil_registration',
          subjects: ['identity']
        }
      }
    })
  })

  it('should throw an error when setting a qualification with no label', () => {
    expect(() =>
      Document.setQualification({}, { purpose: 'invoice' })
    ).toThrow()
  })

  it('should throw an error when setting a qualification with an unknown label', () => {
    expect(() =>
      Document.setQualification({}, { label: 'dummy', purpose: 'invoice' })
    ).toThrow()
  })

  it('should throw an error when setting a qualification with missing attributes', () => {
    const qualification = {
      label: 'health_invoice'
    }
    expect(() => Document.setQualification({}, qualification)).toThrow()
  })

  it('should inform when setting an unknown subject', () => {
    const qualification = {
      label: 'health_invoice',
      purpose: 'invoice',
      sourceCategory: 'health',
      subjects: ['very_hard_drugs']
    }
    Document.setQualification({}, qualification)
    expect(console.info).toHaveBeenCalledTimes(1)
  })
})
describe('qualifications items', () => {
  const isAttributeValueAuthorized = (attributeVal, authorizedValues) => {
    let isAuthorized
    if (Array.isArray(attributeVal)) {
      isAuthorized = attributeVal.some(s => authorizedValues.includes(s))
    } else {
      isAuthorized = authorizedValues.includes(attributeVal)
    }
    expect(isAuthorized).toBe(true)
  }

  it('should always define a label', () => {
    qualificationModel.qualifications.forEach(q => {
      expect(q).toHaveProperty('label')
    })
  })

  it('should define authorized attributes', () => {
    qualificationModel.qualifications.forEach(q => {
      if (q.purpose) {
        isAttributeValueAuthorized(
          q.purpose,
          qualificationModel.purposeAuthorizedValues
        )
      }
      if (q.sourceCategory) {
        isAttributeValueAuthorized(
          q.sourceCategory,
          qualificationModel.sourceCategoryAuthorizedValues
        )
      }
      if (q.sourceSubCategory) {
        isAttributeValueAuthorized(
          q.sourceSubCategory,
          qualificationModel.sourceSubCategoryAuthorizedValues
        )
      }
      if (q.subjects) {
        isAttributeValueAuthorized(
          q.subjects,
          qualificationModel.subjectsAuthorizedValues
        )
      }
    })
  })
})
