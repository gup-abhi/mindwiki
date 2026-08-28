import * as Notifications from 'expo-notifications'

import { createNotificationResponseHandler } from '@/services/notifications/response'
import { err, ok } from '@/types/result'

function response(
  identifier: string,
  data: Record<string, unknown>,
  actionIdentifier?: string
) {
  return {
    actionIdentifier,
    notification: { request: { identifier, content: { data } } },
  } as never
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('notification response handler', () => {
  it('accepts Expo default notification-body taps', async () => {
    const handleCandidate = jest.fn().mockResolvedValue(ok('/entry'))
    const navigate = jest.fn()
    const clearResponse = jest.fn().mockResolvedValue(undefined)
    const handle = createNotificationResponseHandler({ handleCandidate, navigate, clearResponse })

    handle(response(
      'request-1',
      { candidateId: 'candidate-1', kind: 'routine' },
      Notifications.DEFAULT_ACTION_IDENTIFIER
    ))
    await flush()

    expect(handleCandidate).toHaveBeenCalledWith('candidate-1')
    expect(navigate).toHaveBeenCalledWith('/entry')
    expect(clearResponse).toHaveBeenCalledTimes(1)
  })

  it('handles two distinct valid taps in one mounted session', async () => {
    const handleCandidate = jest.fn()
      .mockResolvedValueOnce(ok('/entry'))
      .mockResolvedValueOnce(ok('/digest'))
    const navigate = jest.fn()
    const clearResponse = jest.fn().mockResolvedValue(undefined)
    const handle = createNotificationResponseHandler({ handleCandidate, navigate, clearResponse })

    handle(response('request-1', { candidateId: 'candidate-1', kind: 'journal' }))
    handle(response('request-2', { candidateId: 'candidate-2', kind: 'digest' }))
    await flush()

    expect(handleCandidate.mock.calls).toEqual([['candidate-1'], ['candidate-2']])
    expect(navigate.mock.calls).toEqual([['/entry'], ['/digest']])
    expect(clearResponse).toHaveBeenCalledTimes(2)
  })

  it('clears malformed first response then handles a later valid response', async () => {
    const handleCandidate = jest.fn().mockResolvedValue(ok('/challenge'))
    const navigate = jest.fn()
    const clearResponse = jest.fn().mockResolvedValue(undefined)
    const handle = createNotificationResponseHandler({ handleCandidate, navigate, clearResponse })

    handle(response('malformed', { candidateId: 123, kind: 'bogus' }))
    handle(response('valid', { candidateId: 'candidate-2', kind: 'challenge' }))
    await flush()

    expect(handleCandidate).toHaveBeenCalledWith('candidate-2')
    expect(navigate).toHaveBeenCalledWith('/challenge')
    expect(clearResponse).toHaveBeenCalledTimes(2)
  })

  it('deduplicates one identifier but still clears duplicate native cache', async () => {
    const handleCandidate = jest.fn().mockResolvedValue(ok('/entry'))
    const clearResponse = jest.fn().mockResolvedValue(undefined)
    const handle = createNotificationResponseHandler({ handleCandidate, navigate: jest.fn(), clearResponse })
    const tapped = response('same-request', { candidateId: 'candidate-1', kind: 'journal' })

    handle(tapped)
    handle(tapped)
    await flush()

    expect(handleCandidate).toHaveBeenCalledTimes(1)
    expect(clearResponse).toHaveBeenCalledTimes(2)
  })

  it('clears response when candidate handling fails', async () => {
    const clearResponse = jest.fn().mockResolvedValue(undefined)
    const handle = createNotificationResponseHandler({
      handleCandidate: jest.fn().mockResolvedValue(err('READ_FAILED', 'Failed')),
      navigate: jest.fn(),
      clearResponse,
    })

    handle(response('failed', { candidateId: 'candidate-1', kind: 'journal' }))
    await flush()

    expect(clearResponse).toHaveBeenCalledTimes(1)
  })
})