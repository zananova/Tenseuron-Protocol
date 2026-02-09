// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Receipt Redemption Contract (Mode B Settlement)
 * 
 * Allows users to redeem signed receipts for payment
 * Enforces dispute window before final settlement
 * Supports multi-chain redemption
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ReceiptRedemption {
    string public networkId;
    address public networkToken; // Optional: network-specific token (0x0 for native token)
    uint256 public disputeWindow; // Seconds
    
    struct Receipt {
        bytes32 taskId;
        address recipient;
        uint256 amount;
        uint256 timestamp;
        uint256 disputeWindowEnd;
        bytes32 receiptHash; // Hash of receipt data
        bool redeemed;
    }
    
    mapping(bytes32 => Receipt) public receipts;
    mapping(bytes32 => bool) public redeemedReceipts; // Track by receipt hash
    
    event ReceiptSubmitted(bytes32 indexed receiptHash, bytes32 indexed taskId, address indexed recipient, uint256 amount);
    event ReceiptRedeemed(bytes32 indexed receiptHash, address indexed recipient, uint256 amount);
    event ReceiptDisputed(bytes32 indexed receiptHash, address indexed disputer);
    
    constructor(
        string memory _networkId,
        address _networkToken,
        uint256 _disputeWindow
    ) {
        networkId = _networkId;
        networkToken = _networkToken;
        disputeWindow = _disputeWindow;
    }
    
    /**
     * Submit receipt for redemption
     * Receipt must be signed by validators
     * 
     * @param receiptHash Hash of receipt data (computed off-chain)
     * @param taskId Task identifier
     * @param recipient Payment recipient
     * @param amount Payment amount
     * @param timestamp Receipt timestamp
     * @param validatorSignatures Array of validator signatures (EIP-191)
     * @param validatorAddresses Array of validator addresses (must match signatures)
     */
    function submitReceipt(
        bytes32 receiptHash,
        bytes32 taskId,
        address recipient,
        uint256 amount,
        uint256 timestamp,
        bytes[] calldata validatorSignatures,
        address[] calldata validatorAddresses
    ) external {
        require(receiptHash != bytes32(0), "Invalid receipt hash");
        require(!redeemedReceipts[receiptHash], "Receipt already redeemed");
        require(validatorSignatures.length == validatorAddresses.length, "Mismatched signatures");
        require(validatorSignatures.length > 0, "No signatures provided");
        
        // Verify receipt hash matches provided data
        bytes32 computedHash = keccak256(abi.encodePacked(
            networkId,
            taskId,
            recipient,
            amount,
            timestamp,
            block.chainid
        ));
        require(computedHash == receiptHash, "Receipt hash mismatch");
        
        // Verify signatures (EIP-191)
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            receiptHash
        ));
        
        for (uint256 i = 0; i < validatorSignatures.length; i++) {
            address signer = recoverSigner(messageHash, validatorSignatures[i]);
            require(signer == validatorAddresses[i], "Invalid signature");
        }
        
        // Store receipt
        receipts[receiptHash] = Receipt({
            taskId: taskId,
            recipient: recipient,
            amount: amount,
            timestamp: timestamp,
            disputeWindowEnd: timestamp + disputeWindow,
            receiptHash: receiptHash,
            redeemed: false
        });
        
        redeemedReceipts[receiptHash] = false; // Mark as submitted but not redeemed
        
        emit ReceiptSubmitted(receiptHash, taskId, recipient, amount);
    }
    
    /**
     * Redeem receipt after dispute window
     */
    function redeemReceipt(bytes32 receiptHash) external {
        Receipt storage receipt = receipts[receiptHash];
        require(receipt.receiptHash != bytes32(0), "Receipt not found");
        require(!receipt.redeemed, "Already redeemed");
        require(block.timestamp >= receipt.disputeWindowEnd, "Dispute window not yet passed");
        
        receipt.redeemed = true;
        redeemedReceipts[receiptHash] = true;
        
        // Transfer funds
        if (networkToken == address(0)) {
            // Native token
            (bool success, ) = receipt.recipient.call{value: receipt.amount}("");
            require(success, "Transfer failed");
        } else {
            // ERC20 token
            IERC20 token = IERC20(networkToken);
            require(token.transfer(receipt.recipient, receipt.amount), "Token transfer failed");
        }
        
        emit ReceiptRedeemed(receiptHash, receipt.recipient, receipt.amount);
    }
    
    /**
     * Dispute receipt (during dispute window)
     * Requires stake to prevent spam
     */
    function disputeReceipt(bytes32 receiptHash, bytes calldata evidence) external payable {
        Receipt storage receipt = receipts[receiptHash];
        require(receipt.receiptHash != bytes32(0), "Receipt not found");
        require(!receipt.redeemed, "Already redeemed");
        require(block.timestamp < receipt.disputeWindowEnd, "Dispute window passed");
        require(msg.value > 0, "Dispute requires stake");
        
        // In production, would trigger dispute resolution
        // For now, just emit event
        emit ReceiptDisputed(receiptHash, msg.sender);
    }
    
    /**
     * Recover signer from signature (EIP-191)
     */
    function recoverSigner(bytes32 messageHash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        
        if (v < 27) {
            v += 27;
        }
        
        require(v == 27 || v == 28, "Invalid signature v");
        
        return ecrecover(messageHash, v, r, s);
    }
    
    /**
     * Get receipt status
     */
    function getReceiptStatus(bytes32 receiptHash) external view returns (
        bool exists,
        bool redeemed,
        uint256 disputeWindowEnd,
        bool canRedeem
    ) {
        Receipt memory receipt = receipts[receiptHash];
        exists = receipt.receiptHash != bytes32(0);
        redeemed = receipt.redeemed;
        disputeWindowEnd = receipt.disputeWindowEnd;
        canRedeem = exists && !redeemed && block.timestamp >= receipt.disputeWindowEnd;
    }
    
    // Allow contract to receive native tokens (for funding)
    receive() external payable {}
}
