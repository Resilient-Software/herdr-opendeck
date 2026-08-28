import { config } from "@elgato/eslint-config";

export default [
	...config.recommended,
	{
		rules: {
			"jsdoc/require-jsdoc": "off",
			"jsdoc/require-param": "off",
			"jsdoc/require-param-description": "off",
			"jsdoc/require-returns": "off",
		},
	},
];
