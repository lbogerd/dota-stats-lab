plugins {
    application
    java
    id("com.gradleup.shadow") version "8.3.6"
}

group = "lab.dota"
version = "0.1.0"

repositories { mavenCentral() }

java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(21)) }
}

dependencies {
    implementation("com.skadistats:clarity:4.0.1")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.3")
    implementation("org.apache.commons:commons-compress:1.27.1")
    implementation("com.github.luben:zstd-jni:1.5.7-3")
    runtimeOnly("org.slf4j:slf4j-simple:2.0.17")
    testImplementation(platform("org.junit:junit-bom:5.12.1"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application { mainClass.set("lab.dota.parser.Main") }

tasks.test { useJUnitPlatform() }

tasks.shadowJar {
    archiveFileName.set("dota-replay-exporter.jar")
    mergeServiceFiles()
    manifest { attributes["Main-Class"] = application.mainClass.get() }
}

tasks.build { dependsOn(tasks.shadowJar) }
