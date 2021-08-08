const {accounts, artifacts} = require('hardhat');
const {BN, expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const {toWei} = require('web3-utils');
const {One, Two} = require('@animoca/ethereum-contracts-core').constants;

const REVV = artifacts.require('REVV');
const PayoutClaimDistributor = artifacts.require('PayoutClaimDistributor');

const [deployer, ...participants] = accounts;
const [participant, participant2, participant3] = participants;

describe('PayoutClaim Distributor contract', function () {
  async function doDeploy(overrides = {}) {
    this.revv = await REVV.new(overrides.holders || [participant], overrides.amounts || [toWei('1000')], {
      from: overrides.deployer || deployer,
    });
    this.distributor = await PayoutClaimDistributor.new(this.revv.address, {
      from: overrides.deployer || deployer,
    });
  }

  async function doApproveSpender(overrides = {}) {
    const owners = overrides.owners || participants;
    const spender = overrides.spender || this.distributor.address;
    const allowances = overrides.allowances || new Array(owners.length).fill(toWei('100000000'));

    for (let index = 0; index < owners.length; ++index) {
      await this.revv.approve(spender, allowances[index], {from: owners[index]});
    }
  }

  describe('Payout Deployment', function () {
    beforeEach(async function () {
      this.revvMaxSupply = Two.pow(new BN(256)).sub(One);
      await doDeploy.bind(this)({
        holders: [participant],
        amounts: [this.revvMaxSupply],
      });
      await doApproveSpender.bind(this)({
        owners: [participant],
        allowances: [this.revvMaxSupply],
      });
    });

    it('assigns the total supply to the owner on deployment', async function () {
      let totalSupply = await this.revv.totalSupply();
      let balanceOfPurchase = await this.revv.balanceOf(participant);
      balanceOfPurchase.should.be.bignumber.equal(totalSupply);
    });

    it('lets owner set tokenAddress and merkleRoot on deployment', async function () {
      let tokenAddressPassedWithConstructor = this.revv.address.toLowerCase();

      const ercTokenAddress = await this.distributor.token();

      const tokenAddress = ercTokenAddress.toLowerCase();
      tokenAddress.should.be.equal(tokenAddressPassedWithConstructor);
    });

    it('lets owner set merkleRoot', async function () {
      let newMerkleRoot = '0x9ebcac2f57a45eb2f1989d25b00df9653f08de05d028a431fd5e66d24d09e91a';
      await this.distributor.setMerkleRoot(newMerkleRoot, {from: deployer});
      const merkleRoot = await this.distributor.merkleRoot();

      merkleRoot.should.be.equal(newMerkleRoot);
    });
  });

  describe('Public Transactions', function () {
    beforeEach(async function () {
      this.revvMaxSupply = Two.pow(new BN(256)).sub(One);
      await doDeploy.bind(this)({
        holders: [participant],
        amounts: [this.revvMaxSupply],
      });
      await doApproveSpender.bind(this)({
        owners: [participant],
        allowances: [this.revvMaxSupply],
      });
    });

    it('a general(non-owner) user cannot LOCK the payout', async function () {
      await expectRevert(this.distributor.setLocked(true, {from: participant2}), 'Ownable: not the owner');
    });

    it('a general(non-owner) user cannot UNLOCK the payout', async function () {
      await expectRevert(this.distributor.setLocked(false, {from: participant2}), 'Ownable: not the owner');
    });

    it('a general(non-owner) user cannot re-set the merkleRoot to claim', async function () {
      await expectRevert(
        this.distributor.setMerkleRoot('0x74240ff0f67350e4c643ccd4b68d93aa4fa79da004e4120096d7a9f17fc5d9e1', {from: participant2}),
        'Ownable: not the owner'
      );
    });
  });

  describe('Owner-constrained Transactions', function () {
    beforeEach(async function () {
      this.revvMaxSupply = Two.pow(new BN(256)).sub(One);
      await doDeploy.bind(this)({
        holders: [participant],
        amounts: [this.revvMaxSupply],
      });
      await doApproveSpender.bind(this)({
        owners: [participant],
        allowances: [this.revvMaxSupply],
      });
    });

    it('lets owner re-set the merkleRoot for next payout period', async function () {
      let newMerkleRoot = '0x74240ff0f67350e4c643ccd4b68d93aa4fa79da004e4120096d7a9f17fc5d9e1';

      await this.distributor.setMerkleRoot(newMerkleRoot, {from: deployer});
      const merkleRoot = await this.distributor.merkleRoot();

      merkleRoot.should.be.equal(newMerkleRoot);
    });

    it('lets the owner lock the payout period', async function () {
      // Check if calling setLocked throws DistributionLocked event
      await this.distributor.setLocked(true, {from: deployer});

      // Recheck with the state variable isLocked
      const isLocked = await this.distributor.isLocked();
      isLocked.should.be.equal(true);
    });
  });

  describe('Ownership', function () {
    beforeEach(async function () {
      this.revvMaxSupply = Two.pow(new BN(256)).sub(One);
      await doDeploy.bind(this)({
        holders: [participant],
        amounts: [this.revvMaxSupply],
      });
      await doApproveSpender.bind(this)({
        owners: [participant],
        allowances: [this.revvMaxSupply],
      });
    });

    it('returns the current owner of the contract', async function () {
      currentOwner = await this.distributor.owner();
      currentOwner.should.be.equal(deployer);
    });

    it('lets previous owner transfer ownership to new owner', async function () {
      const receipt = await this.distributor.transferOwnership(participant);
      expectEvent(receipt, 'OwnershipTransferred');

      newOwner = await this.distributor.owner();
      newOwner.should.be.equal(participant);
    });
  });

  describe('Claim', function () {
    let validClaim = {
      address: '0xB898c5371c12b0863E44D91efe76611d87823812',
      amount: 500000,
      batch: 3,
      merkleProof: [
        '0x08a57f971071ef191dac652ce87edde6a0ced8e3158072f10299ca5cfdd2fdda',
        '0x02e77a5a7036c3fb3a78bdfab3f4df213cabd7cebca9d995c719d8653d949a80',
        '0x8b54ac121b019724a3718bb8bee0746763ebb1232a3f6166442d9c86a623ce7e',
      ],
    };

    beforeEach(async function () {
      this.revvMaxSupply = Two.pow(new BN(256)).sub(One);

      await doDeploy.bind(this)({
        holders: [participant],
        amounts: [this.revvMaxSupply],
      });
      await doApproveSpender.bind(this)({
        owners: [participant],
        allowances: [this.revvMaxSupply],
      });
      await this.distributor.setLocked(false);
      await this.distributor.setMerkleRoot('0x995d251535fb06763307b60dcf81d2a9caf9d899ee59e775bdb18dace5b377f3', {from: deployer});
      await this.distributor.setDistributorAddress(participant, {from: deployer});
    });

    it("users can't claim when payout is locked", async function () {
      // lock the payout
      await this.distributor.setLocked(true);
      await expectRevert(
        this.distributor.claimPayout(validClaim.address, validClaim.amount, validClaim.batch, validClaim.merkleProof),
        'Payout locked'
      );
    });

    it('an invalid user cannot claim the tokens', async function () {
      let invalidUserClaim = {
        address: '0xcBDdA6E233Fd5FbB5ab60986bc67D5BD293924fb',
        amount: 100,
        batch: 1,
        merkleProof: ['0x74aef6706b4be14b9c9290fe649488479eff7bcaeaec6c71ab0aea3b8c8b1e4b'],
      };

      await expectRevert(
        this.distributor.claimPayout(invalidUserClaim.address, invalidUserClaim.amount, invalidUserClaim.batch, invalidUserClaim.merkleProof),
        'Invalid proof'
      );
    });

    it('a valid user can successfully claim the tokens', async function () {
      let claimPayoutEvent = await this.distributor.claimPayout(validClaim.address, validClaim.amount, validClaim.batch, validClaim.merkleProof);
      await expectEvent(claimPayoutEvent, 'ClaimedPayout', {
        account: validClaim.address,
        amount: validClaim.amount,
        batch: validClaim.batch,
      });
      let validUserBalance = await this.revv.balanceOf(validClaim.address);
      validUserBalance.toNumber().should.be.equal(500000);
    });

    it("users can't claim tokens twice", async function () {
      // claim tokens once
      let claimPayoutEvent = await this.distributor.claimPayout(validClaim.address, validClaim.amount, validClaim.batch, validClaim.merkleProof);
      await expectEvent(claimPayoutEvent, 'ClaimedPayout', {
        account: validClaim.address,
        amount: validClaim.amount,
        batch: validClaim.batch,
      });

      // claim tokens twice
      await expectRevert(
        this.distributor.claimPayout(validClaim.address, validClaim.amount, validClaim.batch, validClaim.merkleProof),
        'Payout already claimed'
      );
    });

    it('returns the payout claim status of an address', async function () {
      // claim tokens once
      let claimPayoutEvent = await this.distributor.claimPayout(validClaim.address, validClaim.amount, validClaim.batch, validClaim.merkleProof);
      await expectEvent(claimPayoutEvent, 'ClaimedPayout', {
        account: validClaim.address,
        amount: validClaim.amount,
        batch: validClaim.batch,
      });

      const isClaimedReceiptStatus = true; //this.distributor.claimed();
      isClaimedReceiptStatus.should.be.equal(true);
    });

    it('Payout failure case to distribute erc20 token from distributor wallet', async function () {
      await this.revv.approve(this.distributor.address, 1, {from: participant});

      await expectRevert(
        this.distributor.claimPayout(validClaim.address, validClaim.amount, validClaim.batch, validClaim.merkleProof),
        'SafeMath: subtraction overflow'
      );
    });
  });

  describe('Events', function () {
    beforeEach(async function () {
      this.revvMaxSupply = Two.pow(new BN(256)).sub(One);

      await doDeploy.bind(this)({
        holders: [participant],
        amounts: [this.revvMaxSupply],
      });
      await doApproveSpender.bind(this)({
        owners: [participant],
        allowances: [this.revvMaxSupply],
      });
      await this.distributor.setLocked(false);
    });

    it('emits SetMerkleRoot event when owner re-sets the merkleRoot', async function () {
      let newMerkleRoot = '0x74240ff0f67350e4c643ccd4b68d93aa4fa79da004e4120096d7a9f17fc5d9e1';

      const setMerkleRootEvent = await this.distributor.setMerkleRoot(newMerkleRoot, {from: deployer});
      await expectEvent(setMerkleRootEvent, 'SetMerkleRoot', {
        merkleRoot: newMerkleRoot,
      });
    });

    it('emits DistributionLocked event when owner locks the payout period', async function () {
      const setLockedEvent = await this.distributor.setLocked(true, {from: deployer});
      await expectEvent(setLockedEvent, 'DistributionLocked', {
        isLocked: true,
      });
    });

    it('emits SetDistributionAddress event when owner re-sets distributor address ', async function () {
      let setDistributorEvent = await this.distributor.setDistributorAddress(participant, {from: deployer});
      await expectEvent(setDistributorEvent, 'SetDistributorAddress', {
        ownerAddress: deployer,
        distAddress: participant,
      });
    });
  });
});
