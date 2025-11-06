// netlify/functions/updateHWID.js
import fetch from 'node-fetch';

export async function handler(event) {
  // ✅ CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*", // allow all origins, or put your domain
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  // Handle preflight requests
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const { category, username, password, updatedhwid } = event.queryStringParameters || {};

  if (!category || !username || !password || updatedhwid === undefined) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing category, username, password, or updatedhwid' }),
    };
  }

  // 1. Validate API token
  const authHeader = event.headers.authorization || "";
  const apiToken = authHeader.replace("Bearer ", "").trim();
  if (!apiToken) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Missing API token" }) };
  }

  // 2. Fetch token permissions from GitHub raw file
  const TOKEN_FILE_URL = process.env.GITHUB_TOKEN_FILE_URL;
  if (!TOKEN_FILE_URL) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Token file URL not configured" }) };
  }

  let tokens;
  try {
    const tokenResp = await fetch(TOKEN_FILE_URL);
    if (!tokenResp.ok) throw new Error("Failed to fetch token file");
    tokens = await tokenResp.json();
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to read token permissions" }) };
  }

  // 3. Check token validity & write permissions
  const tokenData = tokens[apiToken];
  if (!tokenData) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Invalid API token" }) };
  }

  const allowedWriteCategories = tokenData.write || [];
  if (!allowedWriteCategories.includes(category)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Token does not have write permission for this category" }) };
  }

  // 4. Fetch user database from GitHub
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_USER = process.env.GITHUB_USER;
  const GITHUB_REPO = process.env.GITHUB_REPO;
  const GITHUB_FILE = process.env.GITHUB_FILE;

  const fileUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

  try {
    const getRes = await fetch(fileUrl, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!getRes.ok) throw new Error('Failed to fetch GitHub file');

    const fileData = await getRes.json();
    const sha = fileData.sha;
    const content = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));

    // 5. Check if user exists
    if (!content[category] || !content[category][username]) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
    }

    const user = content[category][username];

    // 6. Check password
    if (user.password !== password) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid password' }) };
    }

    // 7. Update HWID
    content[category][username].hwid = updatedhwid;

    // 8. Commit changes to GitHub
    const commitRes = await fetch(fileUrl, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({
        message: `Update HWID for user ${username} in category ${category}`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
        sha,
      }),
    });

    if (!commitRes.ok) {
      const errData = await commitRes.json();
      throw new Error(errData.message || 'Failed to update GitHub file');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: `HWID updated successfully for ${username}` }),
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
