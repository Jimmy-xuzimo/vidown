package top.xuzimo.vidown.data

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow
import top.xuzimo.vidown.core.*

@Entity(tableName = "tasks")
data class TaskEntity(
    @PrimaryKey val id: String,
    val title: String,
    val state: String = TaskState.QUEUED.name,
    val sequence: Long = 0,
    val bytes: Long = 0,
    val total: Long? = null,
    val speed: Long = 0,
    val message: String? = null,
    val outputUri: String? = null,
    val updatedAt: Long = System.currentTimeMillis(),
    val canPause: Boolean = true,
)

@Entity(tableName = "events", primaryKeys = ["taskId", "sequence"])
data class EventEntity(val taskId: String, val sequence: Long, val state: String, val at: Long)

@Dao
abstract class TaskDao {
    @Query("SELECT * FROM tasks ORDER BY updatedAt DESC")
    abstract fun observe(): Flow<List<TaskEntity>>

    @Query("SELECT * FROM tasks WHERE id=:id") abstract suspend fun get(id: String): TaskEntity?

    @Query("SELECT * FROM tasks") abstract suspend fun all(): List<TaskEntity>

    @Insert(onConflict = OnConflictStrategy.ABORT) abstract suspend fun insert(task: TaskEntity)

    @Update protected abstract suspend fun update(task: TaskEntity)

    @Insert protected abstract suspend fun event(event: EventEntity)

    @Query("DELETE FROM tasks WHERE id=:id") abstract suspend fun delete(id: String)

    @Query("DELETE FROM events WHERE taskId=:id") abstract suspend fun deleteEvents(id: String)

    @Transaction
    open suspend fun transition(
        id: String,
        state: TaskState,
        message: String? = null,
        output: String? = null,
    ): TaskEntity {
        val old = requireNotNull(get(id))
        check(TaskTransitions.permits(TaskState.valueOf(old.state), state)) { "非法任务状态转换" }
        val next =
            old.copy(
                state = state.name,
                sequence = old.sequence + 1,
                message = message,
                outputUri = output ?: old.outputUri,
                updatedAt = System.currentTimeMillis(),
            )
        update(next)
        event(EventEntity(id, next.sequence, next.state, next.updatedAt))
        return next
    }

    @Transaction
    open suspend fun progress(id: String, bytes: Long, total: Long?, speed: Long) {
        val old = get(id) ?: return
        if (old.state != TaskState.DOWNLOADING.name) return
        update(
            old.copy(
                sequence = old.sequence + 1,
                bytes = bytes,
                total = total,
                speed = speed,
                updatedAt = System.currentTimeMillis(),
            )
        )
    }

    @Transaction
    open suspend fun remove(id: String) {
        deleteEvents(id)
        delete(id)
    }
}

@Database(entities = [TaskEntity::class, EventEntity::class], version = 1, exportSchema = true)
abstract class VidownDatabase : RoomDatabase() {
    abstract fun tasks(): TaskDao

    companion object {
        fun create(context: Context) =
            Room.databaseBuilder(context, VidownDatabase::class.java, "vidown.db").build()
    }
}
