package expo.modules.clankershell

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

// Output past this is dropped (the stream is still drained so the process never blocks on a full pipe).
private const val MAX_OUTPUT_BYTES = 256 * 1024

private class Capture(stream: InputStream) {
  private val buffer = java.io.ByteArrayOutputStream()
  var truncated = false
    private set
  val reader: Thread = thread(isDaemon = true) {
    val chunk = ByteArray(8192)
    stream.use {
      while (true) {
        val n = it.read(chunk)
        if (n < 0) break
        synchronized(buffer) {
          val room = MAX_OUTPUT_BYTES - buffer.size()
          if (room > 0) buffer.write(chunk, 0, minOf(n, room))
          if (n > room) truncated = true
        }
      }
    }
  }

  fun text(): String = synchronized(buffer) { buffer.toString(Charsets.UTF_8.name()) }
}

class ClankerShellModule : Module() {
  private val running = ConcurrentHashMap<String, Process>()

  override fun definition() = ModuleDefinition {
    Name("ClankerShell")

    /**
     * Runs `command` with /system/bin/sh in `cwd` (a plain filesystem path). Resolves with
     * stdout, stderr, the exit code (-1 when killed) and whether the timeout fired.
     */
    AsyncFunction("exec") Coroutine { id: String, command: String, cwd: String, timeoutMs: Long, env: Map<String, String> ->
      withContext(Dispatchers.IO) {
        val builder = ProcessBuilder("/system/bin/sh", "-c", command).directory(File(cwd))
        builder.environment().putAll(env)
        val process = builder.start()
        running[id] = process
        process.outputStream.close()
        val out = Capture(process.inputStream)
        val err = Capture(process.errorStream)
        val finished = try {
          process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
        } finally {
          running.remove(id)
        }
        if (!finished) process.destroyForcibly()
        out.reader.join(2000)
        err.reader.join(2000)
        mapOf(
          "stdout" to out.text(),
          "stderr" to err.text(),
          "exitCode" to if (finished) process.exitValue() else -1,
          "timedOut" to !finished,
          "truncated" to (out.truncated || err.truncated),
        )
      }
    }

    /** Kills a command started by `exec`; its `exec` call then resolves with exit code -1 or the signal's code. */
    Function("kill") { id: String ->
      running.remove(id)?.destroyForcibly()
      Unit
    }
  }
}
