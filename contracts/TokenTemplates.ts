/**
 * Token Contract Templates
 * 
 * Generates Solidity source code for different token designs
 */

export class TokenTemplates {
  /**
   * Generate burn-on-use token contract
   */
  static generateBurnOnUseToken(name: string, symbol: string, totalSupply: string, burnAmount: string): string {
    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ${name.replace(/\s+/g, '')} {
    string public name = "${name}";
    string public symbol = "${symbol}";
    uint8 public decimals = 18;
    uint256 public totalSupply = ${totalSupply} * 10**18;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    uint256 public constant BURN_AMOUNT = ${burnAmount} * 10**18;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Burn(address indexed from, uint256 value);
    
    constructor() {
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        require(balanceOf[msg.sender] >= amount + BURN_AMOUNT, "Insufficient balance for burn");
        
        balanceOf[msg.sender] -= amount + BURN_AMOUNT;
        balanceOf[to] += amount;
        totalSupply -= BURN_AMOUNT;
        
        emit Transfer(msg.sender, to, amount);
        emit Burn(msg.sender, BURN_AMOUNT);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        require(balanceOf[from] >= amount + BURN_AMOUNT, "Insufficient balance for burn");
        
        balanceOf[from] -= amount + BURN_AMOUNT;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        totalSupply -= BURN_AMOUNT;
        
        emit Transfer(from, to, amount);
        emit Burn(from, BURN_AMOUNT);
        return true;
    }
}`;
  }

  /**
   * Generate earn-only token contract (can only be minted, not bought)
   */
  static generateEarnOnlyToken(name: string, symbol: string, totalSupply: string): string {
    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ${name.replace(/\s+/g, '')} {
    string public name = "${name}";
    string public symbol = "${symbol}";
    uint8 public decimals = 18;
    uint256 public totalSupply = 0;
    uint256 public maxSupply = ${totalSupply} * 10**18;
    
    address public immutable networkContract; // Only network contract can mint
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Mint(address indexed to, uint256 value);
    
    constructor(address _networkContract) {
        networkContract = _networkContract;
    }
    
    // Only network contract can mint (earn-only)
    function mint(address to, uint256 amount) external {
        require(msg.sender == networkContract, "Only network contract can mint");
        require(totalSupply + amount <= maxSupply, "Exceeds max supply");
        
        totalSupply += amount;
        balanceOf[to] += amount;
        
        emit Mint(to, amount);
        emit Transfer(address(0), to, amount);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        
        emit Transfer(from, to, amount);
        return true;
    }
}`;
  }

  /**
   * Generate decay token contract (tokens decay over time)
   */
  static generateDecayToken(name: string, symbol: string, totalSupply: string, decayRate: string, decayPeriod: number): string {
    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ${name.replace(/\s+/g, '')} {
    string public name = "${name}";
    string public symbol = "${symbol}";
    uint8 public decimals = 18;
    uint256 public totalSupply = ${totalSupply} * 10**18;
    
    uint256 public constant DECAY_RATE = ${decayRate}; // e.g., 100 = 1% (basis points)
    uint256 public constant DECAY_PERIOD = ${decayPeriod}; // seconds
    
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public lastDecayTime;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Decay(address indexed account, uint256 amount);
    
    constructor() {
        balanceOf[msg.sender] = totalSupply;
        lastDecayTime[msg.sender] = block.timestamp;
        emit Transfer(address(0), msg.sender, totalSupply);
    }
    
    function applyDecay(address account) internal {
        if (lastDecayTime[account] == 0) {
            lastDecayTime[account] = block.timestamp;
            return;
        }
        
        uint256 timePassed = block.timestamp - lastDecayTime[account];
        if (timePassed >= DECAY_PERIOD) {
            uint256 periods = timePassed / DECAY_PERIOD;
            uint256 decayAmount = (balanceOf[account] * DECAY_RATE * periods) / 10000;
            
            if (decayAmount > 0 && decayAmount <= balanceOf[account]) {
                balanceOf[account] -= decayAmount;
                totalSupply -= decayAmount;
                lastDecayTime[account] = block.timestamp;
                emit Decay(account, decayAmount);
            }
        }
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        applyDecay(msg.sender);
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (lastDecayTime[to] == 0) {
            lastDecayTime[to] = block.timestamp;
        }
        
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        applyDecay(from);
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        if (lastDecayTime[to] == 0) {
            lastDecayTime[to] = block.timestamp;
        }
        
        emit Transfer(from, to, amount);
        return true;
    }
}`;
  }

  /**
   * Generate token with progressive self-burn (anti-rug mechanism)
   * Creator tokens can be burned progressively based on rug severity
   */
  static generateProgressiveBurnToken(
    name: string,
    symbol: string,
    totalSupply: string,
    creatorAddress: string,
    rugDetectionOracle: string
  ): string {
    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ${name.replace(/\s+/g, '')} {
    string public name = "${name}";
    string public symbol = "${symbol}";
    uint8 public decimals = 18;
    uint256 public totalSupply = ${totalSupply} * 10**18;
    uint256 public maxSupply = ${totalSupply} * 10**18;
    
    address public immutable creator;
    address public immutable rugDetectionOracle;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    // Progressive burn tracking
    uint256 public creatorTokensBurned;
    uint256 public totalBurned;
    mapping(bytes32 => bool) public burnExecuted; // signalHash => executed
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event ProgressiveBurn(address indexed creator, uint256 amount, uint256 percentage, bytes32 signalHash);
    
    constructor() {
        creator = ${creatorAddress.startsWith('0x') ? creatorAddress : `address(0x${creatorAddress})`};
        rugDetectionOracle = ${rugDetectionOracle.startsWith('0x') ? rugDetectionOracle : `address(0x${rugDetectionOracle})`};
        balanceOf[creator] = totalSupply;
        emit Transfer(address(0), creator, totalSupply);
    }
    
    /**
     * Progressive burn: burn creator tokens based on rug severity
     * Can only be called by rug detection oracle
     * The harder they rug, the more they lose
     */
    function executeProgressiveBurn(
        bytes32 signalHash,
        uint256 burnPercentage
    ) external {
        require(msg.sender == rugDetectionOracle, "Only rug detection oracle can execute burn");
        require(burnPercentage > 0 && burnPercentage <= 100, "Invalid burn percentage");
        require(!burnExecuted[signalHash], "Burn already executed for this signal");
        
        uint256 creatorBalance = balanceOf[creator];
        if (creatorBalance == 0) return;
        
        // Calculate burn amount
        uint256 burnAmount = (creatorBalance * burnPercentage) / 100;
        
        // Burn tokens
        balanceOf[creator] -= burnAmount;
        totalSupply -= burnAmount;
        totalBurned += burnAmount;
        creatorTokensBurned += burnAmount;
        
        // Mark as executed
        burnExecuted[signalHash] = true;
        
        emit ProgressiveBurn(creator, burnAmount, burnPercentage, signalHash);
        emit Transfer(creator, address(0), burnAmount);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        
        emit Transfer(from, to, amount);
        return true;
    }
    
    /**
     * Get creator's remaining balance after burns
     */
    function getCreatorRemainingBalance() external view returns (uint256) {
        return balanceOf[creator];
    }
    
    /**
     * Get total amount burned from creator
     */
    function getCreatorBurnedAmount() external view returns (uint256) {
        return creatorTokensBurned;
    }
}`;
  }

  /**
   * Generate stake-required token contract
   */
  static generateStakeRequiredToken(name: string, symbol: string, totalSupply: string, minStake: string): string {
    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ${name.replace(/\s+/g, '')} {
    string public name = "${name}";
    string public symbol = "${symbol}";
    uint8 public decimals = 18;
    uint256 public totalSupply = ${totalSupply} * 10**18;
    
    uint256 public constant MIN_STAKE = ${minStake} * 10**18;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public stakedBalance;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Stake(address indexed account, uint256 amount);
    event Unstake(address indexed account, uint256 amount);
    
    constructor() {
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }
    
    function stake(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        require(amount >= MIN_STAKE, "Below minimum stake");
        
        balanceOf[msg.sender] -= amount;
        stakedBalance[msg.sender] += amount;
        
        emit Stake(msg.sender, amount);
    }
    
    function unstake(uint256 amount) external {
        require(stakedBalance[msg.sender] >= amount, "Insufficient staked balance");
        
        stakedBalance[msg.sender] -= amount;
        balanceOf[msg.sender] += amount;
        
        emit Unstake(msg.sender, amount);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        
        emit Transfer(from, to, amount);
        return true;
    }
}`;
  }
}
