import { LifiStep, Process } from '@lifi/types'
import {
  errorCodes as MetaMaskErrorCodes,
  getMessageFromCode,
} from 'eth-rpc-errors'

import { fetchTxErrorDetails } from '../helpers'
import ChainsService from '../services/ChainsService'
import {
  ErrorMessage,
  EthersErrorMessage,
  EthersErrorType,
  LifiError,
  LifiErrorCode,
  MetaMaskProviderErrorCode,
  NotFoundError,
  ProviderError,
  RPCError,
  ServerError,
  SlippageError,
  TransactionError,
  UnknownError,
  ValidationError,
} from './errors'
import { formatTokenAmountOnly } from './utils'

/**
 * Available MetaMask error codes:
 *
 * export const errorCodes: ErrorCodes = {
     rpc: {
      invalidInput: -32000,
      resourceNotFound: -32001,
      resourceUnavailable: -32002,
      transactionRejected: -32003,
      methodNotSupported: -32004,
      limitExceeded: -32005,
      parse: -32700,
      invalidRequest: -32600,
      methodNotFound: -32601,
      invalidParams: -32602,
      internal: -32603,
    },
    provider: {
      userRejectedRequest: 4001,
      unauthorized: 4100,
      unsupportedMethod: 4200,
      disconnected: 4900,
      chainDisconnected: 4901,
    },
  };
 *
 * For more information about error codes supported by metamask check
 * https://github.com/MetaMask/eth-rpc-errors
 * https://eips.ethereum.org/EIPS/eip-1474#error-codes
 * https://eips.ethereum.org/EIPS/eip-1193#provider-errors
 */

export const getTransactionNotSentMessage = async (
  step?: LifiStep,
  process?: Process
): Promise<string> => {
  let transactionNotSend =
    'Transaction was not sent, your funds are still in your wallet'

  // add information about funds if available
  if (step) {
    const chainService = ChainsService.getInstance()
    const chain = await chainService.getChainById(step.action.fromChainId)

    transactionNotSend += ` (${formatTokenAmountOnly(
      step.action.fromToken,
      step.action.fromAmount
    )} ${step.action.fromToken.symbol} on ${chain.name})`
  }

  transactionNotSend +=
    ", please retry.<br/>If it still doesn't work, it is safe to delete this transfer and start a new one."

  // add transaction explorer link if available
  transactionNotSend +=
    process && process.txLink
      ? `<br>You can check the failed transaction&nbsp;<a href="${process.txLink}" target="_blank" rel="nofollow noreferrer">here</a>.`
      : ''

  return transactionNotSend
}

export const getTransactionFailedMessage = async (
  step: LifiStep,
  txLink?: string
): Promise<string> => {
  const chainsService = ChainsService.getInstance()
  const chain = await chainsService.getChainById(step.action.toChainId)

  const baseString = `It appears that your transaction may not have been successful.
  However, to confirm this, please check your ${chain.name} wallet for ${step.action.toToken.symbol}.`
  return txLink
    ? `${baseString}
    You can also check the&nbsp;<a href="${txLink}" target="_blank" rel="nofollow noreferrer">block explorer</a> for more information.`
    : baseString
}

export const parseError = async (
  e: any,
  step?: LifiStep,
  process?: Process
): Promise<LifiError> => {
  if (e instanceof LifiError) {
    return e
  }

  if (e.code) {
    // MetaMask errors have a numeric error code
    if (typeof e.code === 'number') {
      if (Object.values(MetaMaskErrorCodes.rpc).includes(e.code)) {
        // rpc errors
        // underpriced errors are sent as internal errors, so we need to parse the message manually
        if (
          e.code === MetaMaskErrorCodes.rpc.internal &&
          (e.message?.includes(EthersErrorMessage.Underpriced) ||
            e.message?.includes(EthersErrorMessage.LowReplacementFee))
        ) {
          return new RPCError(
            LifiErrorCode.TransactionUnderpriced,
            ErrorMessage.TransactionUnderpriced,
            await getTransactionNotSentMessage(step, process),
            e.stack
          )
        }

        if (
          e.message?.includes(EthersErrorMessage.LowGas) ||
          e.message?.includes(EthersErrorMessage.OutOfGas)
        ) {
          return new TransactionError(
            LifiErrorCode.GasLimitError,
            ErrorMessage.GasLimitLow,
            await getTransactionNotSentMessage(step, process),
            e.stack
          )
        }

        return new RPCError(
          e.code,
          getMessageFromCode(e.code),
          await getTransactionNotSentMessage(step, process),
          e.stack
        )
      }

      // provider errors
      if (Object.values(MetaMaskErrorCodes.provider).includes(e.code)) {
        return new ProviderError(
          e.code,
          getMessageFromCode(e.code),
          await getTransactionNotSentMessage(step, process),
          e.stack
        )
      }
    }
  }

  switch (e.code) {
    case EthersErrorType.CallExecption:
      const defaultErrorMessage = await getTransactionNotSentMessage(
        step,
        process
      )
      try {
        if (!step?.action.fromChainId) {
          throw new Error('Signer is not defined.')
        }

        const response = await fetchTxErrorDetails(
          e.transactionHash,
          step?.action.fromChainId
        )

        const errorMessage = response?.error_message ?? e.reason

        const isAllowanceError =
          response?.error_message?.includes(
            EthersErrorMessage.ERC20Allowance
          ) || e.reason?.includes(EthersErrorMessage.ERC20Allowance)

        if (isAllowanceError) {
          return new TransactionError(
            LifiErrorCode.AllowanceRequired,
            e.reason,
            errorMessage,
            e.stack
          )
        }

        // Error messages other than allowance error will be handled in catch block
        throw new Error(e)
      } catch (error) {
        return new ProviderError(
          LifiErrorCode.TransactionFailed,
          e.reason,
          defaultErrorMessage,
          e.stack
        )
      }
    case EthersErrorType.InsufficientFunds:
      return new TransactionError(
        LifiErrorCode.InsufficientFunds,
        e.message,
        await getTransactionNotSentMessage(step, process),
        e.stack
      )
    case EthersErrorType.ActionRejected:
    case MetaMaskProviderErrorCode.userRejectedRequest:
      return new TransactionError(
        LifiErrorCode.TransactionRejected,
        e.message,
        await getTransactionNotSentMessage(step, process),
        e.stack
      )
    case LifiErrorCode.TransactionUnprepared:
      return new TransactionError(
        LifiErrorCode.TransactionUnprepared,
        e.message,
        await getTransactionNotSentMessage(step, process),
        e.stack
      )
    case LifiErrorCode.ValidationError:
      return new TransactionError(
        LifiErrorCode.ValidationError,
        e.message,
        e.htmlMessage
      )
    default:
      return new UnknownError(
        LifiErrorCode.InternalError,
        e.message || ErrorMessage.UnknownError,
        undefined,
        e.stack
      )
  }
}

export const parseBackendError = async (e: any): Promise<LifiError> => {
  let data
  try {
    data = await e.response?.json()
  } catch (error) {
    // ignore
  }
  if (e.response?.status === 400) {
    return new ValidationError(
      data?.message || e.response?.statusText,
      undefined,
      e.stack
    )
  }

  if (e.response?.status === 404) {
    return new NotFoundError(
      data?.message || e.response?.statusText,
      undefined,
      e.stack
    )
  }

  if (e.response?.status === 409) {
    return new SlippageError(
      data?.message || e.response?.statusText,
      ErrorMessage.SlippageError,
      e.stack
    )
  }

  if (e.response?.status === 500) {
    return new ServerError(
      data?.message || e.response?.statusText,
      undefined,
      e.stack
    )
  }

  return new ServerError(ErrorMessage.Default, undefined, e.stack)
}
