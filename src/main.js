// We use chalk to color the usage message
var out = require("chalk");

// yargs helps us elegantly parse the command line
var yargs = require("yargs");

// We use path to find the command inventory file
var path = require("path");

// The yaml module will come in handy for parsing the command inventory file
var yaml = require("js-yaml");

// We need this to load the inventory file
var fs = require("fs-extra");

// Keep track of the root directory of our module,
var rootDir = path.resolve(__dirname);

function stopWithError(error) {
  // Something went wrong at some point so we"re going to stop right away,
  // print out a nice error message and signal the parent process that we
  // stopped because of an error
  process.stderr.write(`\n${out.red("Error:")}\n  ${out.red("✗")} ${out.bold(error.message)}\n\n`) && process.exit(1);
}

function parseCommandOptions(command, cli) {
  var options = {};

  command.options.forEach((option) => {
    if (option.name) {
      options[option.name] = {};
      options[option.name]["alias"]    = option.alias;
      options[option.name]["describe"] = option.description;
      options[option.name]["default"]  = option.default;
      options[option.name]["type"]     = option.type;

      cli.option(option.name, {
        default: option.default,
        describe: option.description,
        type: option.type
      });
    }
  });

  return options;
}

function extractCommand(cli, inventory) {
  // Actually do the hard work and parse the command line
  cli = cli.argv;

  if (cli._.length === 0) {
    // Looks like we did not specify a command so let"s
    // just bail out with the usage message
    yargs.showHelp();
    process.exit(1);
    return;
  }

  // We have successfully parsed the command line, so now let"s construct a command;
  // first keep track of the command type and we assume no options to start with
  var command = {name: cli._[0], options: {}};

  // We want to make sure that the command we"ve just parsed is one we support,
  // so to do that we"re going to look through our inventory and see if we can find it
  var unknown = true;
  inventory.commands.forEach((cmd) => cmd.name === command.name ? unknown = false : null);

  if (unknown) {
    // If this command is one we don"t support, let"s just stop now with a nice
    // error message, but with the usage as well
    yargs.showHelp();
    throw new Error(`Sorry, the ${out.red.bold(command.name)} command is not supported.`);
  }

  // We"ve now got ourselves a parsed command that we support so let"s prepare it
  // for execution
  inventory.commands.forEach((cmd) => { cmd.name === command.name && cmd.options &&

    // so first, let"s fill the command with all its expected options
    cmd.options.forEach((option) => command.options[option.name] = cli[option.name])});

  // This command should now be ready for further manipulation
  return command;
}

function loadInventory(dir) {

  if (!dir || !fs.existsSync(dir)) {
    // We need to make sure the working directory exists before anything else
    throw new Error("Looks like your working directory is invalid");
  }

  // This is the inventory file we"re looking for
  var file = path.join(dir, "slana.yml");

  if (!fs.existsSync(file)) {
    // We need to make sure the file exists before attempting to load it
    throw new Error("Looks like your Slana file is missing.");
  }

  // This is going to be our inventory content, if any
  var inventory;

  try {
    // First off, let"s try to find and load the command inventory file
    inventory = yaml.safeLoad(fs.readFileSync(file), "utf8");
  } catch (e) {
      // Catch yaml syntax errors
      throw new Error("Looks like your Slana file is invalid.");
  }

  if (!inventory) {
    // Add an extra sanity check
    throw new Error("Looks like your Slana file is empty.");
  }

  if (!inventory.name) {
    // Make sure we have a name defined
    throw new Error("Looks like your Slana file is missing the name of your command line tool");
  }

  if (!inventory.commands || inventory.commands.count === 0) {
    // Make sure we have one or more commands
    throw new Error("Looks like your Slana file does not specify any commands");
  }

  // This should be a valid inventory
  return inventory;
}

function initializeCLI(inventory, dir) {

  if (!dir || !fs.existsSync(dir)) {
    // We need to make sure the working directory exists before anything else
    throw new Error("Looks like your working directory is invalid");
  }

  // This is the manifest file we"re looking for
  var file = path.join(dir, "package.json");

  if (!fs.existsSync(file)) {
    // We need to make sure the file exists before attempting to load it
    throw new Error("Looks like your package file is missing.");
  }

  // This is going to be our package content, if any
  var pkg;

  try {
    // Load the package manifest to look through it for information
    pkg = require(file);
  } catch (e) {
      // Catch package syntax errors
      throw new Error("Looks like your package file is invalid.");
  }

  if (!pkg.bin || !pkg.bin[inventory.name]) {
    // Let"s make sure the command-line tool was defined in the module"s manifest
    throw new Error("Looks like your command-line tool name is not defined in your manifest");
  }

  // This is a generic usage header that will prefix the help message
  var usage = "<" + out.bold("command") + "> [" + out.bold("options") + "]";

  // Let"s tell yargs what we"re looking for based on our inventory
  return yargs.

          // Prepare a nicely-formatted usage message
         usage(`${out.green("Usage:")}\n ${out.green(inventory.name)} ${out.green(usage)}`).

         // Define the help (usage) option (-h)
         help("help").

         // Make sure the usage message prints out in a compact format
         wrap(null).

         // Insert the version from the package manifest, at the end of the usage message
         version(pkg.version).
         epilog(`${out.gray("v")}${out.gray(pkg.version)}`);
}

function parseCommand (command, cli, dir) {
  if (!command.executor) {
    // We need a command executor, otherwise, there"s nothing to execute
    throw new Error(`Make sure the ${out.green(command.name)} command has a valid command executor`);
  }

  // We will parse the command into this temporary structure and we start off
  // with the values from the inventory
  var cmd = {name: command.name, description: command.description, options: {}};

  try {
    // Attempt to resolve the executor
    cmd.executor = require(path.join(dir, command.executor));

    if (typeof cmd.executor != "function") {
      // We need an executor function, not something else (ie. an object)
      throw new Error();
    }
  } catch (e) {
    // Looks like the executor could not be resolved
    throw new Error(`Make sure the ${out.green(command.name)} command has a valid command executor`);
  }

  if (!command.options || command.options.length === 0) {
    // Not all commands have options
    return cmd;
  }

  // Looks like this command has options, so let"s parse them
  Object.assign(cmd.options, parseCommandOptions(command, cli));

  Object.keys(cmd.options).forEach((optionKey) => {
    if (cmd.options[optionKey].alias) {
      // Include the options and the alias, if any, in the command help message
      cmd.description = "[--" + out.bold(optionKey) + ", -" + out.bold(cmd.options[optionKey].alias) + "] " + cmd.description;
    } else {
      // Include the options without alias
      cmd.description = "[--" + out.bold(optionKey) + "] " + cmd.description;
    }
  });

  // We"ve got ourselves a parsed command, ready for processing
  return cmd;
}

function runCommandExecutor(command, executor) {
  // Let"s attempt to execute the command now
  executor(command);
}

function executeCommand(inventory, cli, dir) {

  if (!dir || !fs.existsSync(dir)) {
    // We need to make sure the working directory exists before anything else
    throw new Error("Looks like your working directory is invalid");
  }

  // Keep track of all command executors
  var executors = {};

  // This is the fun part; we"re going to look through our inventory, command by command,
  // and tell yargs what commands to look for, along with each command"s options, if any
  inventory.commands.forEach((command) => {

    if (!command.name) {
      // We don"t let commands without a name go through
      throw new Error("Make sure each command in your command inventory has a name");
    }

    // Look for the command"s properties, including options, if any
    var cmd = parseCommand(command, cli, dir);

    // The command is ready to be added to the parser
    cli.command(cmd.name, cmd.description, cmd.options);

    // Keep track of this command"s executor
    executors[cmd.name] = cmd.executor;
  });

  // We"ve got ourselves a command line now, so let"s extract the command
  var command = extractCommand(cli, inventory);

  // And finally, let"s execute it
  runCommandExecutor(command, executors[command.name])
}

var slana = {
  stopWithError: function(error) { return stopWithError(error) },
  loadInventory: function(dir) { return loadInventory(dir) },
  initializeCLI: function(inventory, dir) { return initializeCLI(inventory, dir) },
  executeCommand: function(inventory, cli, dir) { return executeCommand(inventory, cli, dir) },
  parseCommand: function(command, cli, dir) { return parseCommand(command, cli, dir) },
  extractCommand: function(cli, inventory, dir) { return extractCommand(cli, inventory, dir) }
}

module.exports = slana;
