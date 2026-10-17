import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function runCommand(argv, timeoutSeconds, cancellable, timeoutMessage) {
    return new Promise((resolve, reject) => {
        // Do not start a new child after the owning indicator was disabled.
        cancellable.set_error_if_cancelled();
        const process = Gio.Subprocess.new(
            argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        let timedOut = false;
        let timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
                timedOut = true;
                timeoutId = 0;
                cancellable.cancel();
                return GLib.SOURCE_REMOVE;
            }
        );
        const removeTimeout = () => {
            if (timeoutId)
                GLib.Source.remove(timeoutId);
            timeoutId = 0;
        };
        const cancelSignal = cancellable.connect(() => {
            // disable() must remove the timer immediately, before the async
            // completion callback gets another turn in the main loop.
            removeTimeout();
            // SIGTERM lets the route helper run its rollback trap.
            process.send_signal(15);
        });
        process.communicate_utf8_async(null, cancellable, (source, result) => {
            removeTimeout();
            cancellable.disconnect(cancelSignal);
            try {
                const [, stdout, stderr] = source.communicate_utf8_finish(result);
                resolve({successful: source.get_successful(), stdout: stdout ?? '', stderr: stderr ?? ''});
            } catch (error) {
                reject(timedOut ? new Error(timeoutMessage) : error);
            }
        });
    });
}
