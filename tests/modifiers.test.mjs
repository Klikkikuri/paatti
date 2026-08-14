import assert from 'assert';

let mockModifiers = {
    aiSlop: true,
    video: true
};

let changeListeners = [];

// Global browser API mock for testing
globalThis.chrome = {
    storage: {
        local: {
            get: async () => ({})
        },
        sync: {
            get: async (keys) => {
                return { modifiers: mockModifiers };
            }
        },
        onChanged: {
            // Store all listeners so multiple modules can subscribe without clobbering each other
            addListener: (fn) => {
                changeListeners.push(fn);
            }
        }
    },
    i18n: {
        getMessage: (key) => {
            const messages = {
                modifierAiSlopTitle: "AI Content Marker",
                modifierAiSlopDesc: "Displays an indicator on headlines for content exhibiting characteristics typical of AI-generated or AI-translated material.",
                modifierAiSlopLabel: "AI",
                modifierAiSlopTooltip: "Content exhibits characteristics typical of AI-generated or AI-translated material.",
                modifierVideoTitle: "Video Content Marker",
                modifierVideoDesc: "Shows a video icon next to headlines when the link is mostly video rather than a written article.",
                modifierVideoLabel: "Video",
                modifierVideoTooltip: "This link is mostly video rather than a written article."
            };
            return messages[key] || "";
        }
    }
};

const { applyModifiers } = await import('../src/modifiers.js');

function setModifiers(newModifiers) {
    mockModifiers = { ...newModifiers };
    changeListeners.forEach(fn => fn({}, "sync"));
}

async function runTests() {
    console.log("Running title modifiers tests...");

    // Test 1: Video modifier adds video badge when label is present and modifier is enabled
    setModifiers({ aiSlop: false, video: true });
    {
        const entry = {
            labels: ["com.github.klikkikuri/type=video"]
        };
        const result = await applyModifiers("Test Video Title", entry);
        assert.strictEqual(result.text, "Test Video Title");
        assert.strictEqual(result.badges.length, 1);
        assert.strictEqual(result.badges[0].tagName, "klikkikuri-video-badge");
        assert.strictEqual(result.badges[0].badgeText, "Video");
        assert.strictEqual(result.badges[0].tooltip, "This link is mostly video rather than a written article.");
        console.log("✅ Passed: Video modifier applies video badge when enabled and label matches");
    }

    // Test 2: Video modifier is ignored when disabled
    setModifiers({ aiSlop: false, video: false });
    {
        const entry = {
            labels: ["com.github.klikkikuri/type=video"]
        };
        const result = await applyModifiers("Test Video Title", entry);
        assert.strictEqual(result.text, "Test Video Title");
        assert.strictEqual(result.badges.length, 0);
        console.log("✅ Passed: Video modifier is ignored when disabled in settings");
    }

    // Test 3: Multiple modifiers apply sequentially (both AI and Video)
    setModifiers({ aiSlop: true, video: true });
    {
        const entry = {
            labels: [
                "com.github.klikkikuri/ai-slop=true",
                "com.github.klikkikuri/type=video"
            ]
        };
        const result = await applyModifiers("Combined Title", entry);
        assert.strictEqual(result.text, "Combined Title");
        assert.strictEqual(result.badges.length, 2);
        assert.strictEqual(result.badges[0].tagName, "klikkikuri-ai-badge");
        assert.strictEqual(result.badges[1].tagName, "klikkikuri-video-badge");
        console.log("✅ Passed: Multiple active modifiers apply badges in sequence");
    }

    // Test 4: Unlabeled entry gets no badges
    {
        const entry = {
            labels: ["com.github.klikkikuri/article-type=article"]
        };
        const result = await applyModifiers("Normal Title", entry);
        assert.strictEqual(result.text, "Normal Title");
        assert.strictEqual(result.badges.length, 0);
        console.log("✅ Passed: Unlabeled entries receive no modifier badges");
    }

    console.log("\n✅ All modifiers tests passed successfully.");
}

runTests().catch((err) => {
    console.error("❌ Test failure:", err);
    process.exit(1);
});
