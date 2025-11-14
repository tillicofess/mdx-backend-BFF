import axios from "axios";

const BASE_URL = "http://localhost:3001"; // 后端接口地址

async function testGetArticle(slug) {
    try {
        const res = await axios.get(`${BASE_URL}/articles/${slug}`);
        console.log("✅ Article fetched successfully:");
        console.log(res.data);
    } catch (error) {
        if (error.response) {
            console.error("❌ Server responded with error:", error.response.data);
        } else {
            console.error("❌ Request failed:", error.message);
        }
    }
}

async function test() {
    console.log("=== Testing MDX Article API ===");
    await testGetArticle("welcome");
}

test();
