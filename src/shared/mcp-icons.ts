import faviconSvg from "../../assets/favicon.svg" with { type: "text" };

/** MCP Implementation.icons for the capa server (spec 2025-11-25). */
export const CAPA_SERVER_ICONS = [
	{
		src: `data:image/svg+xml;base64,${Buffer.from(faviconSvg).toString("base64")}`,
		mimeType: "image/svg+xml",
		sizes: ["any"],
	},
];
