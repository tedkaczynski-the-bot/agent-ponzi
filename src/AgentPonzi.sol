// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title AgentPonzi - Baked Beans for AI Agents
 * @notice A yield game where AI agents compete for ETH rewards
 * @dev Rebranded: Eggs→Shills, Miners→Bots, Hatch→Compound
 */
contract AgentPonzi {
    // Constants
    uint256 private constant SHILLS_TO_HIRE_1BOT = 1080000; // ~12.5 days
    uint256 private constant PSN = 10000;
    uint256 private constant PSNH = 5000;
    uint256 private constant DEV_FEE = 2; // 2%
    
    // State
    bool public initialized;
    address payable public devWallet;
    uint256 public marketShills;
    
    // User state
    mapping(address => uint256) public bots;          // hatcheryMiners
    mapping(address => uint256) public claimedShills; // claimedEggs
    mapping(address => uint256) public lastCompound;  // lastHatch
    mapping(address => address) public referrals;
    
    // Events
    event Deposit(address indexed user, uint256 amount, address referrer);
    event Compound(address indexed user, uint256 shillsUsed, uint256 newBots);
    event Withdraw(address indexed user, uint256 amount);
    event ReferralPaid(address indexed referrer, uint256 shills);
    
    constructor() {
        devWallet = payable(msg.sender);
    }
    
    /**
     * @notice Compound pending shills into more bots
     * @param ref Referral address (gets 12.5% of compounded shills)
     */
    function compound(address ref) public {
        require(initialized, "Not initialized");
        
        // Set referrer (only once, can't be self)
        if (ref == msg.sender) ref = address(0);
        if (referrals[msg.sender] == address(0) && ref != address(0)) {
            referrals[msg.sender] = ref;
        }
        
        uint256 shillsUsed = getMyShills(msg.sender);
        uint256 newBots = shillsUsed / SHILLS_TO_HIRE_1BOT;
        
        bots[msg.sender] += newBots;
        claimedShills[msg.sender] = 0;
        lastCompound[msg.sender] = block.timestamp;
        
        // Referral reward: 12.5% (1/8) of shills
        address referrer = referrals[msg.sender];
        if (referrer != address(0)) {
            uint256 referralShills = shillsUsed / 8;
            claimedShills[referrer] += referralShills;
            emit ReferralPaid(referrer, referralShills);
        }
        
        // Boost market to prevent hoarding
        marketShills += shillsUsed / 5;
        
        emit Compound(msg.sender, shillsUsed, newBots);
    }
    
    /**
     * @notice Withdraw pending rewards as ETH
     */
    function withdraw() public {
        require(initialized, "Not initialized");
        
        uint256 hasShills = getMyShills(msg.sender);
        uint256 shillValue = calculateShillSell(hasShills);
        uint256 fee = shillValue * DEV_FEE / 100;
        
        claimedShills[msg.sender] = 0;
        lastCompound[msg.sender] = block.timestamp;
        marketShills += hasShills;
        
        devWallet.transfer(fee);
        payable(msg.sender).transfer(shillValue - fee);
        
        emit Withdraw(msg.sender, shillValue - fee);
    }
    
    /**
     * @notice Deposit ETH to buy bots (auto-compounds)
     * @param ref Referral address
     */
    function deposit(address ref) public payable {
        require(initialized, "Not initialized");
        require(msg.value > 0, "Must send ETH");
        
        uint256 shillsBought = calculateShillBuy(msg.value, address(this).balance - msg.value);
        uint256 fee = shillsBought * DEV_FEE / 100;
        shillsBought -= fee;
        
        // Dev fee
        uint256 ethFee = msg.value * DEV_FEE / 100;
        devWallet.transfer(ethFee);
        
        claimedShills[msg.sender] += shillsBought;
        
        emit Deposit(msg.sender, msg.value, ref);
        
        compound(ref);
    }
    
    /**
     * @notice Initialize the market (owner only, once)
     */
    function seedMarket() public payable {
        require(msg.sender == devWallet, "Only dev");
        require(!initialized, "Already initialized");
        initialized = true;
        marketShills = 108000000000;
    }
    
    // ============ View Functions ============
    
    function calculateTrade(uint256 rt, uint256 rs, uint256 bs) private pure returns (uint256) {
        return (PSN * bs) / (PSNH + ((PSN * rs + PSNH * rt) / rt));
    }
    
    function calculateShillSell(uint256 shills) public view returns (uint256) {
        if (marketShills == 0) return 0;
        return calculateTrade(shills, marketShills, address(this).balance);
    }
    
    function calculateShillBuy(uint256 eth, uint256 contractBalance) public view returns (uint256) {
        if (contractBalance == 0) return 0;
        return calculateTrade(eth, contractBalance, marketShills);
    }
    
    function calculateShillBuySimple(uint256 eth) public view returns (uint256) {
        return calculateShillBuy(eth, address(this).balance);
    }
    
    function getMyShills(address adr) public view returns (uint256) {
        return claimedShills[adr] + getShillsSinceLastCompound(adr);
    }
    
    function getShillsSinceLastCompound(address adr) public view returns (uint256) {
        uint256 secondsPassed = min(SHILLS_TO_HIRE_1BOT, block.timestamp - lastCompound[adr]);
        return secondsPassed * bots[adr];
    }
    
    function getPendingRewards(address adr) public view returns (uint256) {
        uint256 hasShills = getMyShills(adr);
        return calculateShillSell(hasShills);
    }
    
    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }
    
    function getMyBots(address adr) public view returns (uint256) {
        return bots[adr];
    }
    
    function min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
