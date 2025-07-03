require("dotenv").config();
const { ethers } = require("ethers");
const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    if (!process.env.PRIVATE_KEY || !process.env.CLAIM_TOKEN || !process.env.GITHUB_REPOSITORY) {
      return { statusCode: 500, body: JSON.stringify({ error: "Server misconfigured" }) };
    }

    const GITHUB_API_URL = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/contents/claims.json`;
    const GITHUB_TOKEN = process.env.CLAIM_TOKEN;

    const body = JSON.parse(event.body);
    const { wallet: targetWallet } = body;

    if (!targetWallet) return { statusCode: 400, body: JSON.stringify({ error: "Wallet is required" }) };

    let normalizedWallet;
    try {
      normalizedWallet = ethers.getAddress(targetWallet);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid wallet address" }) };
    }

    async function readClaims() {
      const response = await fetch(GITHUB_API_URL, {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "chips-faucet",
        },
      });

      if (response.status === 404) return { content: {}, sha: null };

      const data = await response.json();
      const content = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
      return { content, sha: data.sha };
    }

    async function writeClaims(claims, sha) {
      const content = Buffer.from(JSON.stringify(claims, null, 2)).toString("base64");
      const body = {
        message: `Update claims.json for ${targetWallet}`,
        content,
      };
      if (sha) body.sha = sha;

      const response = await fetch(GITHUB_API_URL, {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "chips-faucet",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(`GitHub write error: ${err.message}`);
      }
    }

    const { content: claims, sha } = await readClaims();

    if (claims[normalizedWallet]) {
      return { statusCode: 400, body: JSON.stringify({ error: "Wallet already claimed" }) };
    }

    const provider = new ethers.JsonRpcProvider("http://20.63.3.101:8545");
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const tx = await wallet.sendTransaction({
      to: normalizedWallet,
      value: ethers.parseEther("1000"),
    });

    const receipt = await tx.wait();

    claims[normalizedWallet] = 1;
    await writeClaims(claims, sha);

    const allClaims = Object.keys(claims).reverse();

    return {
      statusCode: 200,
      body: JSON.stringify({
        txHash: receipt.hash,
        totalClaimed: allClaims.length,
        allClaims,
      }),
    };
  } catch (error) {
    console.error("Claim error:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: `Claim failed: ${error.message}` }) };
  }
};
