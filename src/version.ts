import { ethers } from 'ethers'
import { LifiStep, Route } from '.'
import Big from 'big.js'

export const name = '@lifi/sdk'
export const version = '2.0.0-beta.15'
export const bitizenFeePercent = 0.05
export const lifiGateway =
  '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'.toLowerCase()
export const bitizenGateway = '0x84E235810295Ba8A88EC6b6fe5fFACC84fb5a467'

const bitizenGatewayIface = new ethers.utils.Interface([
  `function swap(
        bytes32 _transactionId,
    address _fromToken,
    uint256 _fromAmount,
    uint256 _feeAmount,
    bytes memory _swapData,
    bytes memory _postSwapData,
    bytes memory _signature
    ) public payable`,
])

export const postModifyStep = function (
  step: LifiStep,
  routeId: string,
  route: Route | null,
  extFeeCost: any
) {
  if (extFeeCost) {
    step.estimate.feeCosts?.push(extFeeCost)
    step.includedSteps[0].estimate.feeCosts?.push(extFeeCost)
  }

  if (step.estimate.approvalAddress.toLowerCase() == lifiGateway) {
    step.estimate.approvalAddress = bitizenGateway
  }
  if (step.includedSteps[0].action.toAddress?.toLowerCase() == lifiGateway) {
    step.includedSteps[0].action.toAddress = bitizenGateway
  }

  if (route) {
    step.action.fromAmount = route.fromAmount
    step.estimate.fromAmount = route.fromAmount
    step.estimate.fromAmountUSD = route.fromAmountUSD
    step.includedSteps[0].action.fromAmount = route.fromAmount
    step.includedSteps[0].estimate.fromAmount = route.fromAmount
  }

  if (step.transactionRequest?.to?.toLowerCase() == lifiGateway) {
    step.transactionRequest.to = bitizenGateway
    const realAmount =
      extFeeCost != null
        ? new Big(step.action.fromAmount)
            .mul(1 - bitizenFeePercent)
            .toFixed(0, Big.roundDown)
        : new Big(step.action.fromAmount)
    step.transactionRequest.data = bitizenGatewayIface.encodeFunctionData(
      'swap',
      [
        routeId,
        step.action.fromToken.address,
        realAmount.toString(),
        new Big(step.action.fromAmount).sub(realAmount).toString(),
        step.transactionRequest.data,
        [],
        [],
      ]
    )
  }
}
