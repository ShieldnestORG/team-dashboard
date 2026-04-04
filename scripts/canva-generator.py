#!/usr/bin/env python3
"""
Canva template generator bridge.
Receives JSON config on stdin, generates a design, outputs file path on stdout.

Required env: CANVA_API_KEY

Config format:
{
  "action": "generate_image" | "generate_video",
  "prompt": "description of what to create",
  "width": 1080,
  "height": 1920,
  "aspectRatio": "9:16",
  "templateId": "optional-canva-template-id",
  "textOverlays": ["optional", "text", "overlays"],
  "brandColors": ["#hex1", "#hex2"]
}

Output: file path to generated asset on stdout
"""

import json
import os
import sys
import tempfile


def main():
    config = json.load(sys.stdin)
    action = config.get("action", "generate_image")
    api_key = os.environ.get("CANVA_API_KEY", "")

    if not api_key:
        print("Error: CANVA_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    # TODO: Implement actual Canva Connect API integration
    # For now, create a placeholder file indicating the expected output
    suffix = ".mp4" if action == "generate_video" else ".png"

    # When implementing:
    # 1. Use Canva Connect API to create/fill a design from template
    # 2. Export the design to the desired format
    # 3. Save to a temp file
    # 4. Print the file path to stdout

    print(
        f"Error: Canva integration not yet implemented. Set up Canva Connect API.",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
