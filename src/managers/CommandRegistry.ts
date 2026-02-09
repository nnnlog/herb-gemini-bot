import {BaseCommand} from '../commands/BaseCommand.js';

export interface CommandRegistry {
    getCommands(): BaseCommand[];
}
