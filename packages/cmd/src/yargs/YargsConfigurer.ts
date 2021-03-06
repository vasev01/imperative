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

import { format, inspect, isNullOrUndefined } from "util";
import { Arguments, Argv } from "yargs";
import { Logger } from "../../../logger";
import { Constants } from "../../../constants";
import { AbstractCommandYargs } from "./AbstractCommandYargs";
import { ICommandDefinition } from "../doc/ICommandDefinition";
import { ICommandResponseParms } from "../doc/response/parms/ICommandResponseParms";
import { CommandProcessor } from "../CommandProcessor";
import { CommandUtils } from "../utils/CommandUtils";
import { IProfileManagerFactory } from "../../../profiles";
import { ICommandProfileTypeConfiguration } from "../doc/profiles/definition/ICommandProfileTypeConfiguration";
import { IHelpGeneratorFactory } from "../help/doc/IHelpGeneratorFactory";
import { CliUtils } from "../../../utilities/src/CliUtils";

/**
 * Before invoking commands, this class configures some settings and callbacks in Yargs,
 * including what happens on syntax failures.
 */
export class YargsConfigurer {
    constructor(private rootCommand: ICommandDefinition,
                private yargs: any,
                private commandRespParms: ICommandResponseParms,
                private profileManagerFactory: IProfileManagerFactory<ICommandProfileTypeConfiguration>,
                private helpGeneratorFactory: IHelpGeneratorFactory,
                private experimentalCommandDescription: string,
                private rootCommandName: string,
                private commandLine: string,
                private envVariablePrefix: string
    ) {
    }

    public configure() {

        /**
         * Add the command definitions to yargs
         */
        const jsonResponseFormat =
            (process.argv.indexOf(CliUtils.getDashFormOfOption(Constants.JSON_OPTION)) >= 0 ||
                process.argv.indexOf(CliUtils.getDashFormOfOption(Constants.JSON_OPTION_ALIAS)) >= 0);

        const logger = Logger.getImperativeLogger();

        const jsonArg: any = {};
        if (jsonResponseFormat) {
            const jsonOptionName: string = Constants.JSON_OPTION;
            jsonArg[jsonOptionName] = true;
        }
        const preferredTerminalWidth = 100;
        const failedCommandHandler = __dirname + "/../handlers/FailedCommandHandler";
        const failedCommandDefinition: ICommandDefinition = {
            name: this.rootCommandName + " " + this.commandLine,
            handler: failedCommandHandler,
            type: "command",
            description: "The command you tried to invoke failed"
        };
        this.yargs.showHelpOnFail(false);
        // finally, catch any undefined commands
        this.yargs.command("*", "Unknown group", (argv: Argv) => {
                    return argv; // no builder
            },
            (argv: any) => {
                const attemptedCommand = argv._.join(" ");
                if (attemptedCommand.trim().length === 0) {
                    if (argv.V) {
                        argv.version = true;
                    }
                    const isJson = argv[Constants.JSON_OPTION] || argv[Constants.JSON_OPTION_ALIAS];

                    // Allocate a help generator from the factory
                    const rootHelpGenerator = this.helpGeneratorFactory.getHelpGenerator({
                        commandDefinition: this.rootCommand,
                        fullCommandTree: this.rootCommand,
                        experimentalCommandsDescription: this.experimentalCommandDescription
                    });

                    new CommandProcessor({
                        definition: this.rootCommand, fullDefinition: this.rootCommand,
                        helpGenerator: rootHelpGenerator,
                        profileManagerFactory: this.profileManagerFactory,
                        rootCommandName: this.rootCommandName,
                        commandLine: this.commandLine,
                        envVariablePrefix: this.envVariablePrefix
                    }).invoke({ arguments: argv, silent: false, responseFormat: (jsonResponseFormat) ? "json" : "default" })
                        .then((response) => {
                            Logger.getImperativeLogger().debug("Root help complete.");
                        })
                        .catch((rejected) => {
                            process.stderr.write("Internal Imperative Error: Root command help error occurred: "
                                + rejected.message + "\n");
                            Logger.getImperativeLogger().error(`Root unexpected help error: ${inspect(rejected)}`);
                        });
                } else {
                    // unknown command, not successful
                    process.exitCode = Constants.ERROR_EXIT_CODE;
                    const lev = require("levenshtein");
                    let minimumLevDistance: number = 999999;
                    let closestCommand: string;

                    const commandTree = CommandUtils.flattenCommandTree(this.rootCommand);

                    for (const command of commandTree) {
                        if (command.fullName.trim().length === 0) {
                            continue;
                        }
                        const compare = new lev(attemptedCommand, command.fullName);
                        if (compare.distance < minimumLevDistance) {
                            minimumLevDistance = compare.distance;
                            closestCommand = command.fullName;
                        }
                    }

                    argv.failureMessage = this.buildFailureMessage(closestCommand);

                    // Allocate a help generator from the factory
                    const rootHelpGenerator = this.helpGeneratorFactory.getHelpGenerator({
                        commandDefinition: failedCommandDefinition,
                        fullCommandTree: failedCommandDefinition,
                        experimentalCommandsDescription: this.experimentalCommandDescription
                    });

                    // Create the command processor for the fail command
                    const failCommand = new CommandProcessor({
                        definition: failedCommandDefinition,
                        fullDefinition: failedCommandDefinition,
                        helpGenerator: rootHelpGenerator,
                        profileManagerFactory: this.profileManagerFactory,
                        rootCommandName: this.rootCommandName,
                        commandLine: this.commandLine,
                        envVariablePrefix: this.envVariablePrefix
                    });

                    // Invoke the fail command
                    failCommand.invoke({ arguments: argv, silent: false, responseFormat: (jsonResponseFormat) ? "json" : "default" })
                        .then((failedCommandResponse) => {
                            logger.debug("Finished invoking the 'FailedCommand' handler");
                        }).catch((err) => {
                        logger.error("%s", err.msg);
                    });
                }
            });

        this.yargs.fail((msg: string, error: Error, failedYargs: any) => {
            process.exitCode = Constants.ERROR_EXIT_CODE;
            AbstractCommandYargs.STOP_YARGS = true; // todo: figure out a better way
            error = error || new Error(msg);

            // Allocate a help generator from the factory
            const failHelpGenerator = this.helpGeneratorFactory.getHelpGenerator({
                commandDefinition: failedCommandDefinition,
                fullCommandTree: failedCommandDefinition,
                experimentalCommandsDescription: this.experimentalCommandDescription
            });

            // Create the command processor for the fail command
            const failCommand = new CommandProcessor({
                definition: failedCommandDefinition,
                fullDefinition: failedCommandDefinition,
                helpGenerator: failHelpGenerator,
                profileManagerFactory: this.profileManagerFactory,
                rootCommandName: this.rootCommandName,
                commandLine: this.commandLine,
                envVariablePrefix: this.envVariablePrefix
            });

            const failureMessage = this.buildFailureMessage();

            // Construct the fail command arguments
            const argv: Arguments = {
                failureMessage,
                error,
                _: [],
                $0: Constants.PRIMARY_COMMAND
            };

            // Invoke the fail command
            failCommand.invoke({ arguments: argv, silent: false, responseFormat: (jsonResponseFormat) ? "json" : "default" })
                .then((failedCommandResponse) => {
                    logger.debug("Finished invoking the 'FailedCommand' handler");
                }).catch((err) => {
                logger.error("%s", err.msg);
            });
        });
        process.on("uncaughtException", (error: Error) => {
            process.exitCode = Constants.ERROR_EXIT_CODE;

            // Allocate a help generator from the factory
            const failHelpGenerator = this.helpGeneratorFactory.getHelpGenerator({
                commandDefinition: failedCommandDefinition,
                fullCommandTree: failedCommandDefinition,
                experimentalCommandsDescription: this.experimentalCommandDescription
            });

            // Create the command processor for failure
            let failureMessage = "Imperative encountered an unexpected exception";
            const failCommand = new CommandProcessor({
                definition: failedCommandDefinition,
                fullDefinition: failedCommandDefinition,
                helpGenerator: failHelpGenerator,
                profileManagerFactory: this.profileManagerFactory,
                rootCommandName: this.rootCommandName,
                commandLine: this.commandLine,
                envVariablePrefix: this.envVariablePrefix
            });

            failureMessage += `\nCommand entered: "${this.rootCommandName} ${this.commandLine}"`;
            const groupValues = this.commandLine.split(" ", 2);
            failureMessage += `\nUse "${this.rootCommandName} ${groupValues[0]} ${groupValues[1]} --help" to view groups, commands, and options.`;

            // Construct the arguments
            const argv: Arguments = {
                failureMessage,
                error,
                _: [],
                $0: Constants.PRIMARY_COMMAND
            };

            // Invoke the fail command processor
            failCommand.invoke({ arguments: argv, silent: false, responseFormat: (jsonResponseFormat) ? "json" : "default" })
                .then((failedCommandResponse) => {
                    logger.debug("Finished invoking the 'FailedCommand' handler");
                }).catch((err) => {
                logger.error("%s", err.msg);
            });
        });
    }

    /**
     * Builds the failure message that is passed to the failedCommand handler
     * @return {string} - Returns the failure message
     */
    private buildFailureMessage(closestCommand?: string) {

        const three: number = 3;
        let commands: string = "";
        let groups: string = " "; // default to " " for proper spacing in message
        let delimiter: string = ""; // used to delimit between possible 'command' values

        let failureMessage = "Command failed due to improper syntax";
        failureMessage += `\nCommand entered: "${this.rootCommandName} ${this.commandLine}"`;
        // limit to three to include two levels of group and command value, if present
        const groupValues = this.commandLine.split(" ", three);

        // loop through the top level groups
        for (const group of this.rootCommand.children) {
            if ((group.name.trim() === groupValues[0]) || (group.aliases[0] === groupValues[0])) {
                groups += groupValues[0] + " ";
                // found the top level group so loop to see if second level group valid
                for (const group2 of group.children) {
                    if ((group2.name.trim() === groupValues[1]) || (group2.aliases[0] === groupValues[1])) {
                        groups += groupValues[1] + " ";
                        // second level group valid so command provided is invalid, retrieve the valid command(s)
                        for (let i = 0; i < group2.children.length; i++) {
                            if (i > 0) {
                                delimiter = ", ";
                            }
                            commands += delimiter + group2.children[i].name;
                        }
                        break;
                    }
                }
                break;
            }
        }

        if (!isNullOrUndefined(closestCommand)) {
            failureMessage += format("\nUnknown group: %s\n", groupValues[0]);
            failureMessage += format("Did you mean: %s?", closestCommand);
        }

        if (commands.length > 0) {
            failureMessage += `\nAvailable commands are "${commands}".`;
        }
        failureMessage += `\nUse "${this.rootCommandName}${groups}--help" to view groups, commands, and options.`;
        return failureMessage;
    }

    // /**
    //  * Constructs the response object for invoking help and error command handlers.
    //  * @param {boolean} silent - Enable silent mode
    //  * @param {boolean} printJsonResponse - Print a JSON response if requested.
    //  * @return {CommandResponse} - Returns the constructed command response object
    //  */
    // private buildResponseObject(silent = false, printJsonResponse = false): CommandResponse {
    //     return new CommandResponse({
    //         log: this.commandRespParms.log,
    //         silent: silent,
    //         printJsonOnResponse: printJsonResponse,
    //         primaryTextColor: this.commandRespParms.primaryTextColor,
    //         progressBarSpinner: this.commandRespParms.progressBarSpinner,
    //         progressBarPollFrequency: this.commandRespParms.progressBarPollFrequency
    //     });
    // }
}
