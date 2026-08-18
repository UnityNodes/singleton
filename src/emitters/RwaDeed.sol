// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * A minimal ERC-721 standing in for a tokenised real world asset on Sepolia.
 *
 * The registry never touches this contract. It exists only so the two lender
 * contracts have a real token to check ownership against, and so the demo has
 * one asset with one identity: (chainKey, address(this), tokenId).
 */
contract RwaDeed {
    string public constant name = "Singleton Demo Deed";
    string public constant symbol = "DEED";

    address public immutable issuer;

    mapping(uint256 => address) private _owner;
    mapping(address => uint256) private _balance;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    error NotIssuer();
    error AlreadyMinted();
    error NoSuchToken();
    error NotAuthorised();
    error WrongFrom();
    error ZeroRecipient();

    constructor() {
        issuer = msg.sender;
    }

    function mint(address to, uint256 tokenId) external {
        if (msg.sender != issuer) revert NotIssuer();
        if (to == address(0)) revert ZeroRecipient();
        if (_owner[tokenId] != address(0)) revert AlreadyMinted();
        _owner[tokenId] = to;
        _balance[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owner[tokenId];
        if (owner == address(0)) revert NoSuchToken();
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balance[owner];
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        return _approved[tokenId];
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operator[owner][operator];
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operator[owner][msg.sender]) revert NotAuthorised();
        _approved[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operator[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address owner = ownerOf(tokenId);
        if (owner != from) revert WrongFrom();
        if (to == address(0)) revert ZeroRecipient();
        if (
            msg.sender != owner && msg.sender != _approved[tokenId] && !_operator[owner][msg.sender]
        ) {
            revert NotAuthorised();
        }
        delete _approved[tokenId];
        _owner[tokenId] = to;
        _balance[from] -= 1;
        _balance[to] += 1;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd;
    }
}
