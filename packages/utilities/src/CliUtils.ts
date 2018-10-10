/*
* This program and the accompanying materials are made available under the terms of the
* Eclipse Public License v2.0 which accompanies this distribution, and is available at
* https://www.eclipse.org/legal/epl-v20.html
*
* SPDX-License-Identifier: EPL-2.0
*
* Copyright Contributors to the Zowe Project.
*
*/

import { isNullOrUndefined } from "util";
import { ImperativeError } from "../../error";
import { Constants } from "../../constants";
import { Arguments } from "yargs";
import { TextUtils } from "./TextUtils";
import { IOptionFormat } from "./doc/IOptionFormat";
import { Logger } from "../../logger";
import { ICommandOptionDefinition, ICommandPositionalDefinition, CommandProfiles } from "../../cmd";
import { ICommandArguments } from "../../cmd/src/doc/args/ICommandArguments";
import { IProfile } from "../../profiles";

/**
 * Cli Utils contains a set of static methods/helpers that are CLI related (forming options, censoring args, etc.)
 * @export
 * @class CliUtils
 */
export class CliUtils {
    /**
     * Used as the place holder when censoring arguments in messages/command output
     * @static
     * @memberof CliUtils
     */
    public static readonly CENSOR_RESPONSE = "****";

    /**
     * A list of cli options/keywords that should normally be sensored
     * @static
     * @memberof CliUtils
     */
    public static CENSORED_OPTIONS = ["auth", "p", "pass", "password", "passphrase", "credentials",
        "authentication", "basic-auth", "basicAuth"];

    /**
     * Get the 'dash form' of an option as it would appear in a user's command,
     * appending the proper number of dashes depending on the length of the option name
     * @param {string} optionName - e.g. my-option
     * @returns {string} - e.g. --my-option
     */
    public static getDashFormOfOption(optionName: string): string {
        if (!isNullOrUndefined(optionName) && optionName.length >= 1) {
            const dashes = optionName.length > 1 ? Constants.OPT_LONG_DASH : Constants.OPT_SHORT_DASH;
            return dashes + optionName;
        }
        else {
            throw new ImperativeError({
                msg: "A null or blank option was supplied. Please correct the option definition."
            });
        }
    }

    /**
     * Copy and censor any sensitive CLI arguments before logging/printing
     * @param {string[]} args - The args list to censor
     * @returns {string[]}
     */
    public static censorCLIArgs(args: string[]): string[] {
        const newArgs: string[] = JSON.parse(JSON.stringify(args));
        const censoredValues = CliUtils.CENSORED_OPTIONS.map(CliUtils.getDashFormOfOption);
        for (const value of censoredValues) {
            if (args.indexOf(value) >= 0) {
                const valueIndex = args.indexOf(value);
                if (valueIndex < args.length - 1) {
                    newArgs[valueIndex + 1] = CliUtils.CENSOR_RESPONSE; // censor the argument after the option name
                }
            }
        }
        return newArgs;
    }

    /**
     * Copy and censor a yargs argument object before logging
     * @param {yargs.Arguments} args the args to censor
     * @returns {yargs.Arguments}  a censored copy of the arguments
     */
    public static censorYargsArguments(args: Arguments): Arguments {
        const newArgs: Arguments = JSON.parse(JSON.stringify(args));

        for (const optionName of Object.keys(newArgs)) {
            if (CliUtils.CENSORED_OPTIONS.indexOf(optionName) >= 0) {
                const valueToCensor = newArgs[optionName];
                newArgs[optionName] = CliUtils.CENSOR_RESPONSE;
                for (const checkAliasKey of Object.keys(newArgs)) {
                    if (newArgs[checkAliasKey] === valueToCensor) {
                        newArgs[checkAliasKey] = CliUtils.CENSOR_RESPONSE;
                    }
                }
            }
        }
        return newArgs;
    }


    /**
     * Accepts the full set of loaded profiles and attempts to match the option names supplied with profile keys.
     *
     * @param {Map<string, IProfile[]>} profileMap - the map of type to loaded profiles. The key is the profile type
     * and the value is an array of profiles loaded for that type.
     *
     * @param {string[]} profileOrder - the order to process the profile types (keys of the map)
     *
     * @param {(Array<ICommandOptionDefinition | ICommandPositionalDefinition>)} options - the full set of command options
     * for the command being processed
     *
     * @returns {*}
     *
     * @memberof CliUtils
     */
    public static extractOptValueFromProfiles(profiles: CommandProfiles, profileOrder: string[],
                                              options: Array<ICommandOptionDefinition | ICommandPositionalDefinition>): any {
        let args: any = {};

        // Iterate through the profiles in the order they appear in the list provided. For each profile found, we will
        // attempt to match the option name to a profile property exactly - and extract the value from the profile.
        profileOrder.forEach((profileType) => {

            // Get the first profile loaded - for now, we won't worry about profiles and double-type loading for dependencies
            const profile: IProfile = profiles.get(profileType, false);
            if (profile == null) {
                throw new ImperativeError({
                    msg: `Profile of type "${profileType}" does not exist within the loaded profiles for the command.`,
                    additionalDetails: `Command preparation was attempting to extract option values from profiles.`
                });
            }

            // For each option - extract the value if that exact property exists
            options.forEach((opt) => {
                console.log("@@@PROF");
                console.log(profile);
                if (profile.hasOwnProperty(opt.name) && !args.hasOwnProperty(opt.name) && profile[opt.name] !== undefined) {
                    const keys =  CliUtils.setOptionValue(opt.name, profile[opt.name]);
                    args = {...args, ...keys};
                }
            });
        });
        return args;
    }

    /**
     * Using Object.assign(), merges objects in the order they appear in call. Object.assign() copies and overwrites
     * existing properties in the target object, meaning property precedence is least to most (left to right).
     *
     * See details on Object.assign() for nuance.
     *
     * @param {...any[]} args - variadic set of objects to be merged
     *
     * @returns {*} - the merged object
     *
     */
    public static mergeArguments(...args: any[]): any {
        let merged = {};
        args.forEach((obj) => {
            merged = {...merged, ...obj};
        });
        return merged;
    }

    /**
     * Accepts the full set of command options and extracts their values from environment variables that are set.
     *
     * @param {(Array<ICommandOptionDefinition | ICommandPositionalDefinition>)} options - the full set of options
     * specified on the command definition. Includes both the option definitions and the positional definitions.
     *
     * @returns {ICommandArguments["args"]} - the argument style object with both camel and kebab case keys for each
     * option specified in environment variables.
     *
     */
    public static extractEnvForOptions(envPrefix: string,
                                       options: Array<ICommandOptionDefinition | ICommandPositionalDefinition>): ICommandArguments["args"] {
        const args: ICommandArguments["args"] = {};
        options.forEach((opt) => {
            const envValue = CliUtils.getEnvValForOption(envPrefix, opt.name);
            if (envValue != null) {
                CliUtils.setOptionValue(opt.name, envValue);
            }
        });
        return args;
    }

    /**
     * Get the value of an environment variable associated with the specified option name.
     * The option name can be specified in camelCase or in kabab-style.
     * Regardless of the style of the option name, the corresponding environment variable will
     * be all upper case with underscores where the dashes would be in the kabab style.
     * The name of the host CLI application and the name of the command will be pre-pended
     * to the environment variable name.
     *
     * Example: someOptionName or some-option-name would retrieve the value of an environment
     * variable named <CLI Name>_<Command Name>_SOME_OPTION_NAME.
     *
     * @param {string} cmdName - The name of the command that is being run.
     *
     * @param {string} camelOrKababOption - The name of the option in either camelCase or kabab-style.
     *
     * @returns {string | null} - The value of the environment variable which corresponds
     *      to the supplied option for the supplied command. If no such environment variable
     *      exists we return null.
     *
     * @memberof CliUtils
     */
    public static getEnvValForOption(cmdName: string, camelOrKababOption: string): string | null {
        /* todo: ask for host CLI name as another parameter, or do the find-up ourself.
           We cannot call findPackageBinName() because of circular dependency.

        const hostCliName = ImperativeConfig.instance.findPackageBinName();
        if (hostCliName === null) {
            Logger.getImperativeLogger().error("Unable to retrieve the host CLI name, " +
                "so cannot form an environment variable name for command = " +
                `'${cmdName}' and option = '${camelOrKababOption}'.`
             );
            return null;
        }
        */

        const optChoices: IOptionFormat = CliUtils.getOptionFormat(camelOrKababOption);

        // todo: Form hostCliName, cmdName, and optChoices.kebabCase into an environment variable

        // todo: Get the value of the environment variable

        return null;
    }

    /**
     * Constructs the yargs style positional argument string.
     * @static
     * @param {boolean} positionalRequired - Indicates that this positional is required
     * @param {string} positionalName - The name of the positional
     * @returns {string} - The yargs style positional argument string (e.g. <name>);
     * @memberof CliUtils
     */
    public static getPositionalSyntaxString(positionalRequired: boolean, positionalName: string): string {
        const leftChar = positionalRequired ? "<" : "[";
        const rightChar = positionalRequired ? ">" : "]";
        return leftChar + positionalName + rightChar;
    }

    /**
     * Format the help header - normally used in help generation etc.
     * @static
     * @param {string} header
     * @param {string} [indent=" "]
     * @param {string} color
     * @returns {string}
     * @memberof CliUtils
     */
    public static formatHelpHeader(header: string, indent: string = " ", color: string): string {
        if (isNullOrUndefined(header) || header.trim().length === 0) {
            throw new ImperativeError({
                msg: "Null or empty header provided; could not be formatted."
            });
        }
        const numDashes = header.length + 1;
        const headerText = TextUtils.formatMessage("{{indent}}{{headerText}}\n{{indent}}{{dashes}}",
            { headerText: header.toUpperCase(), dashes: Array(numDashes).join("-"), indent });
        return TextUtils.chalk[color](headerText);
    }


    /**
     * Accepts an option name and its value and returns the arguments style object.
     *
     * @param {string} optName - The command option name, usually in kebab case (or a single word)
     *
     * @param {*} value - The value to assign to the argument
     *
     * @returns {ICommandArguments["args"]} - The argument style object
     *
     * @example <caption>Create Argument Object</caption>
     *
     * CliUtils.setOptionValue("my-option", "value");
     *
     * // returns
     * {
     *    "myOption": "value",
     *    "my-option": "value"
     * }
     *
     */
    public static setOptionValue(optName: string, value: any): ICommandArguments["args"] {
        const names: IOptionFormat = CliUtils.getOptionFormat(optName);
        const args: ICommandArguments["args"] = {};
        args[names.camelCase] = value;
        args[names.kebabCase] = value;
        return args;
    }

    public static buildBaseArgs(args: Arguments): ICommandArguments {
        const impArgs = { ...args };
        Object.keys(impArgs).forEach((key) => {
            if (impArgs[key] === undefined) {
                delete impArgs[key];
            }
        });
        delete impArgs.$0;
        delete impArgs._;
        return {
            commands: args._,
            executable: args.$0,
            args: impArgs
        };
    }

    /**
     * Takes a key and converts it to both camelCase and kebab-case.
     *
     * @param key The key to transform
     *
     * @returns An object that contains the new format.
     *
     * @example <caption>Conversion of keys</caption>
     *
     * CliUtils.getOptionFormat("helloWorld");
     *
     * // returns
     * const return1 = {
     *     key: "helloWorld",
     *     camelCase: "helloWorld",
     *     kebabCase: "hello-world"
     * }
     *
     * /////////////////////////////////////////////////////
     *
     * CliUtils.getOptionFormat("hello-world");
     *
     * // returns
     * const return2 = {
     *     key: "hello-world",
     *     camelCase: "helloWorld",
     *     kebabCase: "hello-world"
     * }
     *
     * /////////////////////////////////////////////////////
     *
     * CliUtils.getOptionFormat("hello--------world");
     *
     * // returns
     * const return3 = {
     *     key: "hello--------world",
     *     camelCase: "helloWorld",
     *     kebabCase: "hello-world"
     * }
     *
     * /////////////////////////////////////////////////////
     *
     * CliUtils.getOptionFormat("hello-World-");
     *
     * // returns
     * const return4 = {
     *     key: "hello-World-",
     *     camelCase: "helloWorld",
     *     kebabCase: "hello-world"
     * }
     */
    public static getOptionFormat(key: string): IOptionFormat {
        return {
            camelCase: key.replace(/(-+\w?)/g, (match, p1) => {
                /*
                 * Regular expression checks for 1 or more "-" characters followed by 0 or 1 word character
                 * The last character in each match is converted to upper case and returned only if it
                 * isn't equal to "-"
                 *
                 * Examples: (input -> output)
                 *
                 * - helloWorld         -> helloWorld
                 * - hello-world        -> helloWorld
                 * - hello--------world -> helloWorld
                 * - hello-World-       -> helloWorld
                 */
                const returnChar = p1.substr(-1).toUpperCase();
                return returnChar !== "-" ? returnChar : "";
            }),
            kebabCase: key.replace(/(-*[A-Z]|-{2,}|-$)/g, (match, p1, offset, inputString) => {
                /*
                 * Regular expression matches the following:
                 *
                 * 1. Any string segment containing 0 or more "-" characters followed by any uppercase letter.
                 * 2. Any string segment containing 2 or more consecutive "-" characters
                 * 3. Any string segment where the last character is "-"
                 *
                 * Matches for 1.
                 *
                 * - "A"           -> If condition 1.2
                 * - "-B"          -> If condition 2.2
                 * - "------C"     -> If condition 2.2
                 *
                 * Matches for 2.
                 *
                 * - "--"          -> If condition 2.1.1
                 * - "-------"     -> If condition 2.1.1 or 2.1.2
                 *
                 * 2.1.1 will be entered if the match is the last sequence of the string
                 * 2.1.2 will be entered if the match is not the last sequence of the string
                 *
                 * Matches for 3.
                 * - "-<end_of_string>" -> If condition 1.1
                 *
                 * Examples: (input -> output)
                 *
                 * - helloWorld         -> hello-world
                 * - hello-world        -> hello-world
                 * - hello--------world -> hello-world
                 * - hello-World-       -> hello-world
                 */

                if (p1.length === 1) {                                          // 1
                    if (p1 === "-") {                                           // 1.1
                        // Strip trailing -
                        return "";
                    } else {                                                    // 1.2
                        // Change "letter" to "-letter"
                        return "-" + p1.toLowerCase();
                    }
                } else {                                                        // 2
                    const returnChar = p1.substr(-1); // Get the last character of the sequence

                    if (returnChar === "-") {                                   // 2.1
                        if (offset + p1.length === inputString.length) {        // 2.1.1
                            // Strip a trailing -------- sequence
                            return "";
                        } else {                                                // 2.1.2
                            // Change a sequence of -------- to a -
                            return "-";
                        }
                    } else {                                                    // 2.2
                        // Change a sequence of "-------letter" to "-letter"
                        return "-" + returnChar.toLowerCase();
                    }
                }
            }),
            key
        };
    }
}
