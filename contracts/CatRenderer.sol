// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CatData} from "./CatData.sol";
import {Base64} from "./lib/Base64.sol";
import {ICatRenderer} from "./interfaces/ICatRenderer.sol";

/// @title CatRenderer
/// @notice Fully on-chain renderer for Quantum Cats. Composes the 24x24 pixel
/// grid from a 38-bit DNA (25 trait bits + 5 schrodinger cat-state bits +
/// 8 interference-background bits, MSB-first), emits run-length-encoded SVG,
/// and builds the complete tokenURI JSON. The background renders the 8
/// interference bits as diagonal fringe bands — a sampled outcome of a real
/// H-Rz-CZ-H interference experiment.
contract CatRenderer is ICatRenderer {
    uint256 internal constant W = 24;
    uint256 internal constant BITS = 38;

    struct Traits {
        uint8 earShape;
        uint8 earInner;
        uint8 whiskerStyle;
        uint8 whiskerColor;
        uint8 eyeShape;
        uint8 eyeColor;
        uint8 fur;
        uint8 pattern;
        uint8 accessory;
        uint8 bg;
        bool schrodinger;
    }

    // ─── DNA decoding ───────────────────────────────────────────────

    function _field(uint256 dna, uint256 offset, uint256 nbits) internal pure returns (uint256) {
        return (dna >> (BITS - offset - nbits)) & ((1 << nbits) - 1);
    }

    function decode(uint256 dna) public pure returns (Traits memory t) {
        t.earShape = uint8(CatData.MAP_EARSHAPE[_field(dna, 0, 2)]);
        t.earInner = uint8(CatData.MAP_EARINNER[_field(dna, 2, 2)]);
        t.whiskerStyle = uint8(CatData.MAP_WHISKSTYLE[_field(dna, 4, 2)]);
        t.whiskerColor = uint8(_field(dna, 6, 1));
        t.eyeShape = uint8(CatData.MAP_EYESHAPE[_field(dna, 7, 2)]);
        t.eyeColor = uint8(CatData.MAP_EYECOLOR[_field(dna, 9, 3)]);
        t.fur = uint8(CatData.MAP_FUR[_field(dna, 12, 4)]);
        t.pattern = uint8(CatData.MAP_PATTERN[_field(dna, 16, 3)]);
        t.accessory = uint8(CatData.MAP_ACC[_field(dna, 19, 3)]);
        t.bg = uint8(CatData.MAP_BG[_field(dna, 22, 3)]);
        t.schrodinger = ((dna >> 8) & 0x1f) == 0x1f;
    }

    // ─── grid composition ───────────────────────────────────────────

    function _apply(bytes memory g, bytes memory px) internal pure {
        for (uint256 i = 0; i < px.length; i += 3) {
            g[uint8(px[i]) * W + uint8(px[i + 1])] = px[i + 2];
        }
    }

    function _isAny(bytes1 c, bytes memory set) internal pure returns (bool) {
        for (uint256 i = 0; i < set.length; i++) {
            if (c == set[i]) return true;
        }
        return false;
    }

    function composeGrid(uint256 dna) public pure returns (bytes memory g) {
        Traits memory t = decode(dna);
        g = bytes.concat(CatData.GRID); // mutable memory copy

        // ears: blank base ear region, then draw the variant
        if (t.earShape != 0) {
            for (uint256 y = 1; y <= 4; y++) {
                for (uint256 x = 4; x < 19; x++) {
                    if (_isAny(g[y * W + x], "ofi")) g[y * W + x] = ".";
                }
            }
            _apply(g, t.earShape == 1 ? CatData.EAR_ROUNDED : CatData.EAR_FOLDED);
        }

        // whiskers: base grid carries classic; none/long re-draw
        if (t.whiskerStyle != 0) {
            for (uint256 i = 0; i < g.length; i++) {
                if (g[i] == "w") g[i] = ".";
            }
            if (t.whiskerStyle == 2) _apply(g, CatData.WHISK_LONG);
        }

        // eyes: base grid carries round; redraw shape, then hetero recolour
        if (t.eyeShape == 1) _apply(g, CatData.EYE_WIDE);
        else if (t.eyeShape == 2) _apply(g, CatData.EYE_SLIT);
        if (t.eyeColor == 5) {
            _apply(g, t.eyeShape == 0 ? CatData.EYEH_ROUND : t.eyeShape == 1 ? CatData.EYEH_WIDE : CatData.EYEH_SLIT);
        }

        // fur pattern
        if (t.pattern == 1) _apply(g, CatData.PAT_TUXEDO);
        else if (t.pattern == 2) _apply(g, CatData.PAT_PATCH);
        else if (t.pattern == 3) _apply(g, CatData.PAT_TIGER);
        else if (t.pattern == 4) _apply(g, CatData.PAT_CALICO);

        // accessory
        if (t.accessory >= 1 && t.accessory <= 3) _apply(g, CatData.ACC_HAT);
        else if (t.accessory == 4) _apply(g, CatData.ACC_CIG);
        else if (t.accessory == 5) _apply(g, CatData.ACC_CROSS);
        else if (t.accessory == 6) _apply(g, CatData.ACC_SCARF);

        // schrodinger: left half collapses to bone, ribs through the bust
        if (t.schrodinger) {
            for (uint256 y = 0; y < W; y++) {
                for (uint256 x = 0; x < W; x++) {
                    bytes1 c = g[y * W + x];
                    if (x < 12) {
                        if (_isAny(c, "fdl")) c = "k";
                        else if (c == "i") c = "K";
                        else if (c == "p" || c == "n") c = "x";
                        else if (c == "e") c = "W";
                    }
                    if (c == "k" && y > 16 && y % 2 == 0) c = "K";
                    g[y * W + x] = c;
                }
            }
        }
    }

    // ─── colours ────────────────────────────────────────────────────

    function _pal3(bytes memory pal, uint256 idx) internal pure returns (bytes memory hexColor) {
        hexColor = new bytes(6);
        bytes memory hexChars = "0123456789abcdef";
        for (uint256 i = 0; i < 3; i++) {
            uint8 b = uint8(pal[idx * 3 + i]);
            hexColor[i * 2] = hexChars[b >> 4];
            hexColor[i * 2 + 1] = hexChars[b & 0x0f];
        }
    }

    /// @dev colour of one grid cell as 6 lowercase hex chars (no '#')
    function _color(bytes1 c, Traits memory t, uint256 dna, uint256 x, uint256 y)
        internal
        pure
        returns (bytes memory)
    {
        if (c == ".") {
            // interference background: band k reads interference bit k
            // (DNA position 30+k -> dna bit (7-k) from the LSB)
            uint256 k = ((x + y) / 2) % 8;
            uint256 bit = (dna >> (7 - k)) & 1;
            return _pal3(CatData.BG_PAL, uint256(t.bg) * 2 + bit);
        }
        if (c == "f" || c == "d" || c == "l" || c == "n") {
            uint256 role = c == "f" ? 0 : c == "d" ? 1 : c == "l" ? 2 : 4;
            return _pal3(CatData.FUR_PAL, uint256(t.fur) * 5 + role);
        }
        if (c == "i") {
            if (t.earInner == 0) return _pal3(CatData.FUR_PAL, uint256(t.fur) * 5 + 3);
            return _pal3(CatData.INNER_PAL, t.earInner - 1);
        }
        if (c == "e") return _pal3(CatData.EYE_PAL, t.eyeColor);
        if (c == "E") return _pal3(CatData.EYE_PAL, 1); // hetero right iris = blue
        if (c == "w") return _pal3(CatData.WHISK_PAL, t.whiskerColor);
        if (c == "h") return _pal3(CatData.HAT_PAL, (uint256(t.accessory) - 1) * 2);
        if (c == "H") return _pal3(CatData.HAT_PAL, (uint256(t.accessory) - 1) * 2 + 1);
        // fixed chars
        bytes memory chars = CatData.FIXED_CHARS;
        for (uint256 i = 0; i < chars.length; i++) {
            if (c == chars[i]) return _pal3(CatData.FIXED_PAL, i);
        }
        return "ff00ff"; // unreachable; loud if it ever isn't
    }

    // ─── SVG ────────────────────────────────────────────────────────

    function svg(uint256 dna) public pure returns (string memory) {
        bytes memory g = composeGrid(dna);
        Traits memory t = decode(dna);
        bytes memory out = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' shape-rendering='crispEdges' width='480' height='480'>";
        for (uint256 y = 0; y < W; y++) {
            uint256 x = 0;
            while (x < W) {
                bytes memory col = _color(g[y * W + x], t, dna, x, y);
                uint256 x2 = x + 1;
                while (x2 < W && keccak256(_color(g[y * W + x2], t, dna, x2, y)) == keccak256(col)) {
                    x2++;
                }
                out = bytes.concat(
                    out, "<rect x='", bytes(_u(x)), "' y='", bytes(_u(y)),
                    "' width='", bytes(_u(x2 - x)), "' height='1' fill='#", col, "'/>"
                );
                x = x2;
            }
        }
        return string(bytes.concat(out, "</svg>"));
    }

    function _boxColor(bytes1 c, uint256 x, uint256 y) internal pure returns (bytes memory) {
        if (c == ".") {
            // superposition shimmer: fixed interference dither, identical for every box
            uint256 bit = ((x * 7 + y * 13 + (x ^ y)) >> 2) & 1;
            return _pal3(CatData.BOX_BG, bit);
        }
        bytes memory chars = CatData.BOX_CHARS;
        for (uint256 i = 0; i < chars.length; i++) {
            if (c == chars[i]) return _pal3(CatData.BOX_PAL, i);
        }
        return "ff00ff";
    }

    function boxSvg() public pure returns (string memory) {
        bytes memory g = CatData.BOX;
        bytes memory out = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' shape-rendering='crispEdges' width='480' height='480'>";
        for (uint256 y = 0; y < W; y++) {
            uint256 x = 0;
            while (x < W) {
                bytes memory col = _boxColor(g[y * W + x], x, y);
                uint256 x2 = x + 1;
                while (x2 < W && keccak256(_boxColor(g[y * W + x2], x2, y)) == keccak256(col)) {
                    x2++;
                }
                out = bytes.concat(
                    out, "<rect x='", bytes(_u(x)), "' y='", bytes(_u(y)),
                    "' width='", bytes(_u(x2 - x)), "' height='1' fill='#", col, "'/>"
                );
                x = x2;
            }
        }
        return string(bytes.concat(out, "</svg>"));
    }

    // ─── metadata ───────────────────────────────────────────────────

    function _attr(string memory k, string memory v) internal pure returns (bytes memory) {
        return bytes.concat('{"trait_type":"', bytes(k), '","value":"', bytes(v), '"},');
    }

    function attributesJson(uint256 dna) public pure returns (string memory) {
        Traits memory t = decode(dna);
        bytes memory a = bytes.concat(
            _attr("Ear Shape", CatData.earShapeName(t.earShape)),
            _attr("Ear Colour", CatData.earInnerName(t.earInner)),
            _attr("Whiskers", CatData.whiskerStyleName(t.whiskerStyle)),
            _attr("Whisker Colour", CatData.whiskerColorName(t.whiskerColor)),
            _attr("Eye Shape", CatData.eyeShapeName(t.eyeShape)),
            _attr("Eye Colour", CatData.eyeColorName(t.eyeColor))
        );
        a = bytes.concat(
            a,
            _attr("Fur", CatData.furName(t.fur)),
            _attr("Pattern", CatData.patternName(t.pattern)),
            _attr("Accessory", CatData.accessoryName(t.accessory)),
            _attr("Background", CatData.bgName(t.bg)),
            _attr("Schrodinger", t.schrodinger ? "Yes" : "No")
        );
        return string(a);
    }

    function tokenURI(RenderData memory d) external view returns (string memory) {
        bytes memory json;
        if (!d.revealed) {
            json = bytes.concat(
                '{"name":"Quantum Cat #', bytes(_u(d.tokenId)),
                ' [SUPERPOSITION]","description":"Unobserved. A 38-qubit circuit on IBM Quantum hardware ',
                'will collapse this box into a cat. The measurement decides everything; nobody chooses.",',
                '"attributes":[', bytes(_attr("State", "Superposition")),
                bytes(_attr("Job Committed", d.batchId > 0 ? "Yes" : "No")),
                '{"trait_type":"Batch","value":"', bytes(_u(d.batchId)), '"},',
                '{"trait_type":"Commit Count","value":"', bytes(_u(d.commitCount)), '"}],',
                '"image":"data:image/svg+xml;base64,', bytes(Base64.encode(bytes(boxSvg()))), '"}'
            );
        } else {
            bytes memory head = bytes.concat(
                '{"name":"Quantum Cat #', bytes(_u(d.tokenId)),
                '","description":"Collapsed from shot ', bytes(_u(d.shotIndex)),
                ' of IBM Quantum job ', bytes(d.jobId),
                ' on ', bytes(d.backend),
                '. This shot was assigned to this token before the experiment ran. Every trait, the ',
                'Schrodinger cat-state check, and the interference fringes in the background derive ',
                'from that single 38-bit measurement, permanently recorded in the hash-bound archive.",',
                '"attributes":[', bytes(attributesJson(d.dna))
            );
            bytes memory prov = bytes.concat(
                bytes(_attr("IBM Job ID", d.jobId)),
                bytes(_attr("Backend", d.backend)),
                bytes(_attr("Batch", _u(d.batchId))),
                bytes(_attr("Shot Index", _u(d.shotIndex)))
            );
            prov = bytes.concat(
                prov,
                bytes(_attr("Commit Count", _u(d.commitCount))),
                bytes(_attr("Results Hash", _hexb32(d.resultsHash))),
                bytes(_attr("Archive", d.archiveURI)),
                '{"trait_type":"DNA","value":"', bytes(_bits(d.dna)), '"}],'
            );
            json = bytes.concat(
                head, prov,
                '"image":"data:image/svg+xml;base64,', bytes(Base64.encode(bytes(svg(d.dna)))), '"}'
            );
        }
        return string(
            bytes.concat("data:application/json;base64,", bytes(Base64.encode(json)))
        );
    }

    // ─── small utils ────────────────────────────────────────────────

    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v;
        uint256 len;
        while (tmp != 0) { len++; tmp /= 10; }
        bytes memory b = new bytes(len);
        while (v != 0) { b[--len] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(b);
    }

    /// @dev DNA as a 38-char binary string — the literal measurement outcome (shot 0)
    function _bits(uint256 dna) internal pure returns (string memory) {
        bytes memory b = new bytes(BITS);
        for (uint256 i = 0; i < BITS; i++) {
            b[i] = ((dna >> (BITS - 1 - i)) & 1) == 1 ? bytes1("1") : bytes1("0");
        }
        return string(b);
    }

    function _hexb32(bytes32 h) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory b = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            b[i * 2] = hexChars[uint8(h[i]) >> 4];
            b[i * 2 + 1] = hexChars[uint8(h[i]) & 0x0f];
        }
        return string(b);
    }
}
