import { strict as assert } from "assert";

import { NeovimClient } from "neovim";
import { TextEditor, window } from "vscode";

import { EXT_ID } from "../../constants";

import {
    attachTestNvimClient,
    closeAllActiveEditors,
    closeNvimClient,
    openTextDocument,
    sendNeovimKeys,
    sendVSCodeCommand,
    sendVSCodeKeys,
    wait,
} from "./integrationUtils";

function findOutputChannel(): TextEditor | undefined {
    // There might be a better way to find the right channel than this...
    return window.visibleTextEditors.find((e) => {
        const { scheme, path } = e.document.uri;
        return scheme === "output" && path.includes(EXT_ID) && path.endsWith("messages");
    });
}

// On Windows, VSCode uses \r\n as the line break in output documents.
function assertOutputContent(expected: string) {
    const outputEditor = findOutputChannel();
    const content = outputEditor?.document.getText();
    assert.equal(content != null ? content.replace(/\r\n/g, "\n") : content, expected);
}

function assertNoOutputChannel(message = "Output panel should not be visible") {
    assert.equal(findOutputChannel(), undefined, message);
}

async function sendCommandLine(command: string) {
    await sendVSCodeKeys(":");
    await sendVSCodeCommand("vscode-neovim.test-cmdline", command);
    await sendVSCodeCommand("vscode-neovim.commit-cmdline");
}

async function hideOutputPanel() {
    await sendVSCodeCommand("workbench.action.closePanel");
    await wait();
}

describe("Message output", () => {
    let client: NeovimClient;

    before(async () => {
        client = await attachTestNvimClient();
        await openTextDocument({ content: "" });
    });

    beforeEach(async () => {
        await client.setOption("cmdheight", 2);
    });

    after(async () => {
        await closeNvimClient(client);
        await closeAllActiveEditors();
    });

    afterEach(async () => {
        await client.command("messages clear");
        await hideOutputPanel();
    });

    it("should reveal output panel with contents", async () => {
        await sendCommandLine("echo 1 | echom 2 | echo 3 | echom 4");
        await wait();
        assertOutputContent("1\n2\n3\n4");
        await hideOutputPanel();

        await sendCommandLine("messages");
        await wait();
        assertOutputContent("2\n4");
        await hideOutputPanel();

        await sendCommandLine("echo 5 | echo 6 | echo 7");
        await wait();
        assertOutputContent("5\n6\n7");
    });

    it("should not reveal delayed status messages", async () => {
        await sendCommandLine("echom 1 | sleep 1 | echom 2 | echom 3");

        // only one line written at first, should not be revealed yet
        assertNoOutputChannel();

        await wait(1400);
        assertNoOutputChannel();
    });

    it("should suppress one-line 'pattern not found' with cmdheight=1", async () => {
        await client.setOption("cmdheight", 1);
        await sendNeovimKeys(client, "/foobar\n");
        await wait();
        assertNoOutputChannel();

        await sendCommandLine("messages");
        await wait();
        assertOutputContent("E486: Pattern not found: foobar");
    });

    it("should suppress 'pattern not found' with cmdheight=2", async () => {
        await sendNeovimKeys(client, "/foobar\n");
        await wait();
        assertNoOutputChannel();

        await sendCommandLine("messages");
        await wait();
        assertOutputContent("E486: Pattern not found: foobar");
    });

    it("should not reveal output panel when pressing n after search", async () => {
        await sendCommandLine("set shortmess-=S"); // Ensure search count is shown
        await openTextDocument({ content: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10" });
        await sendCommandLine("1");

        // hide output panel before we begin
        await hideOutputPanel();

        // search for a pattern
        await sendNeovimKeys(client, "/[0-9]\n");
        await wait(500);
        assertNoOutputChannel("Output panel should not open after the initial search");

        // press n multiple times
        for (let i = 0; i < 5; i++) {
            await sendNeovimKeys(client, "n");
            await wait(200);
            assertNoOutputChannel(`Output panel should not open on pressing n (iteration ${i})`);
        }
    });
});
