/**
 * AES-GCM AAD binding for a ciphertext stored in SQLite.
 *
 * Binding a value to its row (scope + projectId + serverId + column) means a
 * ciphertext copied into another row will not decrypt. Token rotation is a
 * normal UPDATE of a newly encrypted blob under the same in-memory master key;
 * the OS keychain is not touched.
 */
export interface SecretBinding {
	scope: string;
	projectId?: string;
	serverId?: string;
	column: string;
}

export function encodeSecretAad(binding: SecretBinding): Buffer {
	return Buffer.from(
		[
			"capa/v1",
			binding.scope,
			binding.projectId ?? "",
			binding.serverId ?? "",
			binding.column,
		].join("\0"),
		"utf8",
	);
}

export function variableSecretBinding(
	projectId: string,
	key: string,
): SecretBinding {
	return {
		scope: "variables",
		projectId,
		serverId: key,
		column: "value",
	};
}

export function oauthSecretBinding(
	projectId: string,
	serverId: string,
	column: "access_token" | "refresh_token",
): SecretBinding {
	return {
		scope: "oauth_tokens",
		projectId,
		serverId,
		column,
	};
}

export function gitSecretBinding(
	platform: string,
	host: string | null | undefined,
	column: "access_token" | "refresh_token",
): SecretBinding {
	return {
		scope: "git_integrations",
		projectId: "",
		serverId: `${platform}:${host ?? ""}`,
		column,
	};
}
