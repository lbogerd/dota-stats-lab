import groovy.json.JsonSlurper

plugins {
    application
    java
    id("com.gradleup.shadow") version "8.3.6"
}

val parserIdentityFile = rootProject.file("../parser-identity.json")
val parserIdentity = JsonSlurper().parse(parserIdentityFile) as Map<*, *>
val clarityUpstreamRelease = parserIdentity.requiredString("clarityUpstreamRelease")
val clarityForkRevision = parserIdentity.requiredString("clarityForkRevision")
val exportFormatVersion = parserIdentity.requiredString("exportFormatVersion")

group = "lab.dota"
version = exportFormatVersion

repositories { mavenCentral() }

java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(17)) }
}

dependencies {
    implementation("com.skadistats:clarity:$clarityUpstreamRelease")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.3")
    implementation("org.apache.commons:commons-compress:1.27.1")
    implementation("com.github.luben:zstd-jni:1.5.7-3")
    runtimeOnly("org.slf4j:slf4j-simple:2.0.17")
    testImplementation(platform("org.junit:junit-bom:5.12.1"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application { mainClass.set("lab.dota.parser.Main") }

tasks.processResources {
    from(parserIdentityFile)
}

val verifyClarityRevision by tasks.registering {
    group = "verification"
    description = "Checks that parser-identity.json names the checked-out Clarity fork revision."
    inputs.file(parserIdentityFile)
    inputs.property("clarityForkRevision", clarityForkRevision)

    doLast {
        val clarityDirectory = rootProject.file("../vendor/clarity")
        if (!clarityDirectory.resolve(".git").exists()) {
            logger.lifecycle("Clarity Git metadata is unavailable; using revision from parser-identity.json")
            return@doLast
        }

        val actualRevision = providers.exec {
            commandLine("git", "-C", clarityDirectory.absolutePath, "rev-parse", "HEAD")
        }.standardOutput.asText.get().trim()
        check(actualRevision == clarityForkRevision) {
            "parser-identity.json records Clarity $clarityForkRevision, but vendor/clarity is $actualRevision"
        }

        val upstreamTag = "v$clarityUpstreamRelease"
        val ancestry = providers.exec {
            commandLine("git", "-C", clarityDirectory.absolutePath,
                    "merge-base", "--is-ancestor", upstreamTag, clarityForkRevision)
            isIgnoreExitValue = true
        }
        check(ancestry.result.get().exitValue == 0) {
            "Clarity fork revision $clarityForkRevision is not based on upstream $upstreamTag"
        }
    }
}

tasks.test {
    useJUnitPlatform()
    dependsOn(verifyClarityRevision)
}

tasks.shadowJar {
    archiveFileName.set("dota-replay-exporter.jar")
    mergeServiceFiles()
    manifest { attributes["Main-Class"] = application.mainClass.get() }
}

tasks.build { dependsOn(tasks.shadowJar) }

fun Map<*, *>.requiredString(key: String): String {
    val value = this[key]
    require(value is String && value.isNotBlank()) { "$key must be a non-empty string in parser-identity.json" }
    return value
}
